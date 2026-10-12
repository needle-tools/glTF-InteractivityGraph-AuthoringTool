import {evaluateScalar} from '../scalar.mjs';
import {OPS} from './bytecode.mjs';
// Test oracle for the IR, never imported by either browser player.
export class VM {
    constructor(program,{seed=1,maxDepth=32,scene}={}) {this.sentEvents=[];this.program=program;this.scene=scene;this.memory=[...program.data];this.seed=seed;this.maxDepth=maxDepth;this.steps=0;}
    global(name) {return this.memory[this.program.globals[name]];}
    array(name,length=120) {return this.memory.slice(this.global(name),this.global(name)+length);}
    run(name,args=[],limit=5_000_000) {
        const p=this.program,stack=[],frames=[],pushFrame=(entry,args)=>{if(frames.length>=this.maxDepth)throw new Error('Stack depth exceeded');frames.push({pc:entry,locals:[0,0,0,...args,...Array(p.frameSize-3-args.length).fill(0)]});};
        pushFrame(p.functions[name].entry,args);let result=0,count=0;
        while(frames.length) {
            if(++count>limit)throw new Error('Instruction budget exceeded');this.steps++;
            const frame=frames.at(-1),[op,a,b]=p.code[frame.pc++],pop=()=>stack.pop(),address=()=>Math.trunc(pop());
            const binary=f=>{const right=pop(),left=pop();stack.push(f(left,right));};
            switch(op) {
                case OPS.NATIVE:{const d=p.io[a],args=stack.splice(stack.length-b,b);stack.push(d.jsRound?Math.round(args[0]):evaluateScalar(d.op,args));break;}
                case OPS.READ:case OPS.WRITE:{
                    const descriptor=p.io[a],args=stack.splice(stack.length-b,b);
                    if(descriptor.kind==='send'){this.sentEvents.push({id:descriptor.id,values:Object.fromEntries(descriptor.keys.map((key,j)=>[key,args[j]]))});stack.push(0);break;}
                    if(!this.scene)throw new Error('A scene adapter is required');const indices=args.slice(0,descriptor.indices.length);
                    if(op===OPS.READ){const value=this.scene.get(descriptor.path,indices);stack.push(Number(descriptor.component===undefined?value:value[descriptor.component]));}
                    else{const values=args.slice(indices.length);this.scene.set(descriptor.path,indices,['float3','float4'].includes(descriptor.type)?values.slice(0,descriptor.type==='float3'?3:4):descriptor.type==='bool'?Boolean(values[0]):values[0]);stack.push(0);}break;
                }
                case OPS.AND_VALUE:binary((a,b)=>a?b:a);break;case OPS.OR_VALUE:binary((a,b)=>a?a:b);break;
                case OPS.SELECT:{const no=pop(),yes=pop(),condition=pop();stack.push(condition?yes:no);break;}
                case OPS.CONST:stack.push(a);break;
                case OPS.LOAD:stack.push((b?frame.locals:this.memory)[a]??0);break;
                case OPS.STORE:(b?frame.locals:this.memory)[a]=pop();break;
                case OPS.GET:{const i=address(),base=address();stack.push(this.memory[base+i]??0);break;}
                case OPS.PUT:{const v=pop(),i=address(),base=address();this.memory[base+i]=v;stack.push(v);break;}
                case OPS.DUP:stack.push(stack.at(-1));break;
                case OPS.DUP2:stack.push(...stack.slice(-2));break;
                case OPS.POP:pop();break;
                case OPS.ADD:binary((x,y)=>x+y);break;case OPS.SUB:binary((x,y)=>x-y);break;case OPS.MUL:binary((x,y)=>x*y);break;case OPS.DIV:binary((x,y)=>x/y);break;case OPS.MOD:binary((x,y)=>x%y);break;
                case OPS.NEG:stack.push(-pop());break;case OPS.NOT:stack.push(Number(!pop()));break;case OPS.BITNOT:stack.push(~pop());break;
                case OPS.AND:binary((x,y)=>x&y);break;case OPS.OR:binary((x,y)=>x|y);break;case OPS.XOR:binary((x,y)=>x^y);break;case OPS.SHL:binary((x,y)=>x<<y);break;case OPS.SHR:binary((x,y)=>x>>y);break;case OPS.USHR:binary((x,y)=>x>>>y);break;
                case OPS.EQ:binary((x,y)=>Number(x===y));break;case OPS.NE:binary((x,y)=>Number(x!==y));break;case OPS.LT:binary((x,y)=>Number(x<y));break;case OPS.LE:binary((x,y)=>Number(x<=y));break;case OPS.GT:binary((x,y)=>Number(x>y));break;case OPS.GE:binary((x,y)=>Number(x>=y));break;
                case OPS.FLOOR:stack.push(Math.floor(pop()));break;
                case OPS.RANDOM:this.seed=(this.seed*1664525+1013904223)>>>0;stack.push(this.seed/4294967296);break;
                case OPS.JUMP:frame.pc=a;break;case OPS.JZ:if(!pop())frame.pc=a;break;case OPS.JNZ:if(pop())frame.pc=a;break;
                case OPS.CALL:{const args=stack.splice(stack.length-b,b);const base=stack.length;pushFrame(a,args);frames.at(-1).base=base;break;}
                case OPS.RET:result=pop();stack.length=frame.base??0;frames.pop();if(frames.length)stack.push(result);break;
                case OPS.RESET:this.memory.splice(a,b,...p.data.slice(a,a+b));break;
                case OPS.HALT:frames.length=0;break;
                default:throw new Error('Unknown opcode '+op);
            }
            if(this.observe)this.observe({pc:frames.at(-1)?.pc??-1,stack:[...stack],frames:frames.map(f=>({...f,locals:[...f.locals]})),memory:[...this.memory]});
        }
        return result;
    }
}
