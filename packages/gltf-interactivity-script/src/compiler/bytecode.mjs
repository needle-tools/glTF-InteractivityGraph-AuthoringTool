import {parse} from 'acorn';
import {scalarCall,mathConstants} from '../scalar.mjs';
import {sceneCall,staticBindings} from './scene-api.mjs';

// Numeric JavaScript subset. Unsupported syntax fails at its source location.
// A small stack IR makes recursive functions and dynamic arrays expressible in
// standard interactivity graphs without custom execution nodes or eval.
export const OPS=Object.freeze(Object.fromEntries(['CONST','LOAD','STORE','GET','PUT','DUP','DUP2','POP','ADD','SUB','MUL','DIV','MOD','NEG','NOT','BITNOT','AND','OR','XOR','SHL','SHR','USHR','EQ','NE','LT','LE','GT','GE','FLOOR','RANDOM','JUMP','JZ','JNZ','CALL','RET','RESET','HALT','READ','WRITE','SELECT','AND_VALUE','OR_VALUE','NATIVE'].map((name,i)=>[name,i])));
const binary={'+':'ADD','-':'SUB','*':'MUL','/':'DIV','%':'MOD','&':'AND','|':'OR','^':'XOR','<<':'SHL','>>':'SHR','>>>':'USHR','==':'EQ','===':'EQ','!=':'NE','!==':'NE','<':'LT','<=':'LE','>':'GT','>=':'GE'};
export function compile(source,{arrayCapacity=256,scene}={}) {
    const ast=parse(source,{ecmaVersion:2022,locations:true,sourceType:'script'});
    const code=[],data=[],globals={},functions={},calls=[],sourceMap=[],io=[],arrays={};
    let scope=null;const immutableArrays=new WeakSet();
    const error=(node,message)=>{throw new SyntaxError(`${message} at ${node.loc.start.line}:${node.loc.start.column+1}`);};
    const emit=(name,a=0,b=0,node)=>{const pc=code.length;code.push([OPS[name],a,b]);sourceMap.push(node?{line:node.loc.start.line,column:node.loc.start.column}:null);return pc;};
    const allocate=(name)=>{if(!(name in globals)){globals[name]=data.length;data.push(0);}return globals[name];};
    for(const statement of ast.body) {
        if(statement.type==='VariableDeclaration') {if(statement.kind!=='var')error(statement,'Use function-scoped var declarations');for(const d of statement.declarations) {if(d.id.type!=='Identifier')error(d,'Destructuring is unsupported');allocate(d.id.name);}}
        else if(statement.type==='FunctionDeclaration') {if(statement.params.some(p=>p.type!=='Identifier'))error(statement,'Only named numeric parameters are supported');functions[statement.id.name]={entry:0,params:statement.params.map(p=>p.name),locals:{},calls:new Set(),arrays:[],node:statement};}
        else if(statement.type==='ForStatement'){if(statement.init?.type==='VariableDeclaration')for(const d of statement.init.declarations)allocate(d.id.name);}
        else if(!['ExpressionStatement','ForStatement'].includes(statement.type))error(statement,'Only globals, functions and static events are allowed');
    }
    const bindings=staticBindings(ast,functions,globals,data,scene,error);
    const binding=node=>{
        if(node.type!=='Identifier')error(node,'Expected a numeric identifier');
        if(scope&&node.name in scope.locals)return [scope.locals[node.name],1];
        if(node.name in globals)return [globals[node.name],0];
        error(node,`Unknown identifier ${node.name}`);
    };
    const scan=(node,set,fn)=>{
        if(!node||typeof node!=='object')return;
        if(node.type==='VariableDeclarator') {if(node.id.type!=='Identifier')error(node,'Destructuring is unsupported');set.add(node.id.name);}
        if(node.type==='MemberExpression'&&node.object.type==='ArrayExpression')immutableArrays.add(node.object);
        if(node.type==='CallExpression'&&node.callee.type==='Identifier')fn.calls.add(node.callee.name);
        if(node.type==='ArrayExpression')fn.arrays.push(node);
        for(const [key,value] of Object.entries(node))if(!['loc','start','end'].includes(key)) {
            if(Array.isArray(value))value.forEach(v=>scan(v,set,fn));else if(value&&typeof value==='object')scan(value,set,fn);
        }
    };
    for(const fn of Object.values(functions)) {const names=new Set(fn.params);scan(fn.node.body,names,fn);[...names].forEach((name,i)=>fn.locals[name]=i+3);}
    for(const [name,fn] of Object.entries(functions)) {
        const reaches=(current,seen=new Set())=>{if(current===name)return true;if(seen.has(current)||!functions[current])return false;seen.add(current);return [...functions[current].calls].some(next=>reaches(next,seen));};
        if([...fn.calls].some(next=>reaches(next)))for(const array of fn.arrays)if(!immutableArrays.has(array))error(array,'Mutable arrays in recursive functions require dynamic allocation');
    }
    const frameSize=Math.max(16,...Object.values(functions).map(fn=>Object.keys(fn.locals).length+3));
    function store(left,node) {
        if(left.type==='Identifier')emit('STORE',...binding(left),node);
        else error(left,'Expected identifier store');
    }
    // Pure branches can use math/select directly; effectful branches retain lazy flow.
    const pure=node=>node&&(['Literal','Identifier'].includes(node.type)||node.type==='UnaryExpression'&&pure(node.argument)||['BinaryExpression','LogicalExpression'].includes(node.type)&&pure(node.left)&&pure(node.right)||node.type==='MemberExpression'&&node.computed&&(pure(node.object)||node.object.type==='ArrayExpression')&&pure(node.property)||node.type==='ConditionalExpression'&&pure(node.test)&&pure(node.consequent)&&pure(node.alternate));
    function expression(node) {
        if(!node) {emit('CONST');return;}
        switch(node.type) {
            case 'Literal': if(typeof node.value!=='number'&&typeof node.value!=='boolean')error(node,'Only numeric/boolean literals are supported');emit('CONST',Number(node.value),0,node);break;
            case 'Identifier':emit('LOAD',...binding(node),node);break;
            case 'ArrayExpression': {
                const constant=e=>{
                    if(!e)return 0;
                    if(e.type==='Literal'&&['number','boolean'].includes(typeof e.value))return Number(e.value);
                    if(e.type==='UnaryExpression'&&['+','-'].includes(e.operator)&&e.argument.type==='Literal'&&typeof e.argument.value==='number')return (e.operator==='-'?-1:1)*e.argument.value;
                    error(e,'Array literals must contain numeric constants');
                };
                const base=data.length;const values=node.elements.map(constant),capacity=immutableArrays.has(node)?values.length:Math.max(arrayCapacity,values.length);
                data.push(...values,...Array(capacity-values.length).fill(0));arrays[node.start]={base,capacity,values,immutable:immutableArrays.has(node)};
                if(!immutableArrays.has(node))emit('RESET',base,capacity,node);
                emit('CONST',base,0,node);break;
            }
            case 'MemberExpression': if(node.object.name==='Math'&&Object.hasOwn(mathConstants,node.property.name)){emit('CONST',mathConstants[node.property.name],0,node);break;}if(!node.computed)error(node,'Only numeric array indexing is supported');expression(node.object);expression(node.property);emit('GET',0,0,node);break;
            case 'SequenceExpression':node.expressions.forEach((e,i)=>{expression(e);if(i<node.expressions.length-1)emit('POP');});break;
            case 'BinaryExpression': {
                const op=binary[node.operator];if(!op)error(node,`Unsupported operator ${node.operator}`);expression(node.left);expression(node.right);emit(op,0,0,node);break;
            }
            case 'LogicalExpression': {
                if(!['&&','||'].includes(node.operator))error(node,'Only && and || are supported');
                if(pure(node.right)){expression(node.left);expression(node.right);emit(node.operator==='&&'?'AND_VALUE':'OR_VALUE');break;}expression(node.left);emit('DUP');const jump=emit(node.operator==='&&'?'JZ':'JNZ');emit('POP');expression(node.right);code[jump][1]=code.length;break;
            }
            case 'ConditionalExpression': {if(pure(node.consequent)&&pure(node.alternate)){expression(node.test);expression(node.consequent);expression(node.alternate);emit('SELECT');break;}expression(node.test);const no=emit('JZ');expression(node.consequent);const end=emit('JUMP');code[no][1]=code.length;expression(node.alternate);code[end][1]=code.length;break;}
            case 'UnaryExpression': {
                expression(node.argument);const op={'-':'NEG','!':'NOT','~':'BITNOT','+':null}[node.operator];if(op===undefined)error(node,`Unsupported unary ${node.operator}`);if(op)emit(op,0,0,node);break;
            }
            case 'AssignmentExpression': {
                const left=node.left,op=node.operator==='='?null:binary[node.operator.slice(0,-1)];if(node.operator!=='='&&!op)error(node,'Unsupported assignment');
                if(left.type==='Identifier') {if(op)expression(left);expression(node.right);if(op)emit(op);emit('DUP');store(left,node);}
                else if(left.type==='MemberExpression'&&left.computed) {expression(left.object);expression(left.property);if(op){emit('DUP2');emit('GET');}expression(node.right);if(op)emit(op);emit('PUT',0,0,node);}
                else error(node,'Unsupported assignment target');break;
            }
            case 'UpdateExpression': {
                if(node.argument.type!=='Identifier')error(node,'Indexed increment is unsupported');expression(node.argument);if(!node.prefix)emit('DUP');emit('CONST',1);emit(node.operator==='++'?'ADD':'SUB');if(node.prefix)emit('DUP');store(node.argument,node);break;
            }
            case 'CallExpression': {
                if(node.callee.type==='MemberExpression'&&node.callee.object.name==='scene') {
                    const call=sceneCall(node,error);call.arguments.forEach(expression);const id=io.length;io.push(call.descriptor);emit(call.descriptor.write?'WRITE':'READ',id,call.arguments.length,node);
                } else if(node.callee.type==='MemberExpression'&&['Math','math'].includes(node.callee.object.name)) {
                    const name=node.callee.property.name;if(name==='floor'&&node.arguments.length===1){expression(node.arguments[0]);emit('FLOOR');}
                    else if(name==='random'&&node.arguments.length===0)emit('RANDOM');else{const d=scalarCall(node,error);node.arguments.forEach(expression);const id=io.length;io.push({kind:'native',...d});emit('NATIVE',id,node.arguments.length,node);}
                } else if(node.callee.type==='Identifier'&&functions[node.callee.name]) {
                    const fn=functions[node.callee.name];if(node.arguments.length!==fn.params.length)error(node,'Call arity mismatch');node.arguments.forEach(expression);calls.push([emit('CALL',0,node.arguments.length,node),node.callee.name]);
                } else error(node,'Only direct numeric function calls are supported');break;
            }
            default:error(node,`Unsupported expression ${node.type}`);
        }
    }
    function statement(node,loop) {
        switch(node.type) {
            case 'BlockStatement':node.body.forEach(n=>statement(n,loop));break;
            case 'EmptyStatement':break;
            case 'ExpressionStatement':expression(node.expression);emit('POP');break;
            case 'VariableDeclaration':if(node.kind!=='var')error(node,'Use function-scoped var declarations');node.declarations.forEach(d=>{if(d.init){expression(d.init);store(d.id,d);}});break;
            case 'ReturnStatement':expression(node.argument);emit('RET',0,0,node);break;
            case 'IfStatement': {expression(node.test);const no=emit('JZ');statement(node.consequent,loop);if(node.alternate){const end=emit('JUMP');code[no][1]=code.length;statement(node.alternate,loop);code[end][1]=code.length;}else code[no][1]=code.length;break;}
            case 'ForStatement': {
                if(node.init){if(node.init.type==='VariableDeclaration')statement(node.init);else{expression(node.init);emit('POP');}}
                const start=code.length;expression(node.test??{type:'Literal',value:true,loc:node.loc});const exit=emit('JZ');const control={breaks:[],continues:[]};statement(node.body,control);
                const update=code.length;control.continues.forEach(pc=>code[pc][1]=update);if(node.update){expression(node.update);emit('POP');}emit('JUMP',start);code[exit][1]=code.length;control.breaks.forEach(pc=>code[pc][1]=code.length);break;
            }
            case 'WhileStatement':case 'DoWhileStatement': {
                const start=code.length,control={breaks:[],continues:[]};let exit;
                if(node.type==='WhileStatement'){expression(node.test);exit=emit('JZ');}
                statement(node.body,control);const next=code.length;control.continues.forEach(pc=>code[pc][1]=next);
                if(node.type==='DoWhileStatement'){expression(node.test);emit('JNZ',start);}else emit('JUMP',start);
                if(exit!==undefined)code[exit][1]=code.length;control.breaks.forEach(pc=>code[pc][1]=code.length);break;
            }
            case 'BreakStatement':case 'ContinueStatement':if(!loop||node.label)error(node,'Unsupported labelled/outside-loop jump');loop[node.type==='BreakStatement'?'breaks':'continues'].push(emit('JUMP'));break;
            default:error(node,`Unsupported statement ${node.type}`);
        }
    }
    for(const fn of Object.values(functions)) {scope=fn;fn.entry=code.length;statement(fn.node.body);emit('CONST');emit('RET');}
    calls.forEach(([pc,name])=>code[pc][1]=functions[name].entry);
    return {version:1,code,data,globals,io,bindings,syntax:ast,arrays,functions:Object.fromEntries(Object.entries(functions).map(([name,fn])=>[name,{entry:fn.entry,params:fn.params,locals:fn.locals,calls:[...fn.calls]}])),frameSize,sourceMap};
}
