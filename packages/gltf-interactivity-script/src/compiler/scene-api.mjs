// Compile-time scene names and runtime numeric glTF object-model access.
export function sceneCall(node,fail) {
    const name=node.callee.property.name;
    const methods={
        interpolateTranslation:{path:'/nodes/[node]/translation',type:'float3',write:true,interpolate:true,arity:5},
        interpolateRotation:{path:'/nodes/[node]/rotation',type:'float4',write:true,interpolate:true,arity:6},
        interpolateScale:{path:'/nodes/[node]/scale',type:'float3',write:true,interpolate:true,arity:5},
        setTranslation:{path:'/nodes/[node]/translation',type:'float3',write:true,arity:4},
        setRotation:{path:'/nodes/[node]/rotation',type:'float4',write:true,arity:5},
        setScale:{path:'/nodes/[node]/scale',type:'float3',write:true,arity:4},
        setVisible:{path:'/nodes/[node]/extensions/KHR_node_visibility/visible',type:'bool',write:true,arity:2},
        getVisible:{path:'/nodes/[node]/extensions/KHR_node_visibility/visible',type:'bool',arity:1},
    };
    if(methods[name]) {
        const descriptor=methods[name];if(node.arguments.length!==descriptor.arity)fail(node,'Wrong scene API arity');
        return {descriptor:{...descriptor,indices:['node']},arguments:node.arguments};
    }
    const generic=/^(get|set)(Float|Bool|Int)$/.exec(name);
    if(!generic)fail(node,'Unsupported scene API '+name);
    const literal=node.arguments[0];if(literal?.type!=='Literal'||typeof literal.value!=='string')fail(node,'Object-model paths must be literal strings');
    const path=literal.value,indices=[...path.matchAll(/\[([^\]]+)\]/g)].map(m=>m[1]);
    if(path.includes('{'))fail(node,'Reference templates are outside the numeric API');
    const type=generic[2].toLowerCase(),write=generic[1]==='set';
    if(node.arguments.length!==1+indices.length+(write?1:0))fail(node,'Wrong pointer API arity');
    // Public setters take (path, value, ...indices); IR takes indices followed by value.
    const args=write?[...node.arguments.slice(2),node.arguments[1]]:node.arguments.slice(1);
    return {descriptor:{path,indices,type,write},arguments:args};
}

export function staticBindings(ast,functions,globals,data,scene,fail) {
    const values={};const bindings=[];
    function value(node) {
        if(!node) return 0;
        if(node.type==='Literal')return node.value;
        if(node.type==='Identifier'&&node.name in values)return values[node.name];
        if(node.type==='ArrayExpression')return node.elements.map(value);
        if(node.type==='ObjectExpression')return Object.fromEntries(node.properties.map(p=>{if(p.type!=='Property'||p.computed)fail(p,'Static options only');return [p.key.name??p.key.value,value(p.value)];}));
        if(node.type==='UnaryExpression'){const a=value(node.argument);if(node.operator==='-')return -a;if(node.operator==='+')return +a;if(node.operator==='!')return !a;}
        if(node.type==='BinaryExpression'){const a=value(node.left),b=value(node.right);const ops={'+':()=>a+b,'-':()=>a-b,'*':()=>a*b,'/':()=>a/b,'%':()=>a%b,'<':()=>a<b,'<=':()=>a<=b,'>':()=>a>b,'>=':()=>a>=b,'==':()=>a===b,'===':()=>a===b};if(ops[node.operator])return ops[node.operator]();}
        if(node.type==='CallExpression'&&node.callee.type==='MemberExpression') {
            if(node.callee.object.name==='Math'&&node.callee.property.name==='floor')return Math.floor(value(node.arguments[0]));
            if(node.callee.object.name==='scene'&&node.callee.property.name==='node'){
                const name=value(node.arguments[0]),matches=(scene?.nodes??[]).flatMap((n,i)=>n.name===name?[i]:[]);
                if(matches.length!==1)fail(node,'Scene node must have a unique name: '+name);return matches[0];
            }
        }
        fail(node,'Expected a static scene/event declaration');
    }
    for(const statement of ast.body)if(statement.type==='VariableDeclaration')for(const d of statement.declarations){
        const result=d.init?value(d.init):0;
        if(Array.isArray(result)){
            if(!result.every(n=>typeof n==='number'&&Number.isFinite(n)))fail(d,'Only constant numeric arrays are supported');
            values[d.id.name]=data.length;data[globals[d.id.name]]=data.length;data.push(...result,...Array(Math.max(0,256-result.length)).fill(0));
        }else{if(typeof result!=='number'&&typeof result!=='boolean')fail(d,'Numeric global initializers only');values[d.id.name]=Number(result);data[globals[d.id.name]]=Number(result);}
    }
    function register(node) {
        if(node.type!=='CallExpression'||node.callee.type!=='MemberExpression'||node.callee.object.name!=='events')fail(node,'Only event registrations are allowed at module scope');
        const method=node.callee.property.name,args=node.arguments;
        const simple=['onStart','onTick','onFrame'].includes(method),handler=args[simple?0:1];
        if(handler?.type!=='Identifier'||!functions[handler.name])fail(node,'An event handler must name a function');
        const descriptor={kind:method.slice(2),handler:handler.name,args:[],options:{}};
        if(!simple){descriptor.target=value(args[0]);descriptor.args=args[2]?value(args[2]):[];descriptor.options=args[3]?value(args[3]):{};}
        if(!['Start','Tick','Frame','Select','HoverIn','HoverOut','Receive'].includes(descriptor.kind))fail(node,'Unsupported event '+method);
        if(!Array.isArray(descriptor.args)||typeof descriptor.options!=='object'||Array.isArray(descriptor.options))fail(node,'Invalid event arguments/options');
        if(descriptor.kind==='Receive'){if(typeof descriptor.target!=='string'||!descriptor.args.every(t=>['int','float','bool'].includes(t)))fail(node,'Custom events require an ID and numeric socket types');}
        else if(!simple){if(!Number.isInteger(descriptor.target)||!scene?.nodes[descriptor.target]||!descriptor.args.every(n=>typeof n==='number'&&Number.isFinite(n)))fail(node,'Node events require a scene node and numeric arguments');}
        const arity=['Tick','Frame'].includes(descriptor.kind)?functions[handler.name].params.length:descriptor.args.length;
        if(['Tick','Frame'].includes(descriptor.kind)&&![1,2].includes(arity))fail(node,'Tick/frame handlers accept time and optional delta time');
        if(functions[handler.name].params.length!==arity)fail(node,'Event handler arity mismatch');
        if(descriptor.options.coalesce!==undefined&&typeof descriptor.options.coalesce!=='string')fail(node,'Coalescing requires a named group');
        for(const key of ['immediate','interrupt']) if(descriptor.options[key]!==undefined&&typeof descriptor.options[key]!=='boolean')fail(node,key+' must be a boolean');
        if(descriptor.options.immediate&&descriptor.options.interrupt)fail(node,'Immediate and interrupt callbacks cannot be combined');
        bindings.push(descriptor);
    }
    function declarations(node) {
        if(node.type==='FunctionDeclaration'||node.type==='VariableDeclaration')return;
        if(node.type==='ExpressionStatement'){register(node.expression);return;}
        if(node.type==='ForStatement'){
            if(node.init?.type!=='VariableDeclaration'||node.init.declarations.length!==1)fail(node,'Static loops require one loop variable');
            const d=node.init.declarations[0],name=d.id.name;values[name]=value(d.init);let count=0;
            while(value(node.test)){
                if(++count>4096)fail(node,'Static event loop limit exceeded');
                if(node.body.type==='BlockStatement')node.body.body.forEach(declarations);else declarations(node.body);
                if(node.update?.type!=='UpdateExpression'||node.update.argument.name!==name||node.update.operator!=='++')fail(node,'Static loops require incrementing their index');values[name]++;
            }if(name in globals)data[globals[name]]=values[name];return;
        }
        fail(node,'Only globals, functions and static event declarations are allowed');
    }
    ast.body.forEach(declarations);
    for(const kind of ['Start','Tick','Frame'])if(bindings.filter(b=>b.kind===kind).length>1)fail(ast,'Only one '+kind+' handler is supported');
    return bindings;
}
