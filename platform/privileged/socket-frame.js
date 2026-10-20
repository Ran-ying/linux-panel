import {Readable} from 'node:stream';

// One in-flight reader. Version 1 requests are a single UTF-8 line; version 2
// file transfers follow that line with a counted binary body. Newline search
// stays on bytes so a chunk boundary cannot split the header from the body.
export class ByteQueue {
  constructor(){
    this.parts=[];this.length=0;this.ended=false;this.error=null;this.waiter=null;
  }
  push(buffer){
    if(!buffer?.length)return;
    this.parts.push(buffer);this.length+=buffer.length;this.#wake();
  }
  end(){this.ended=true;this.#wake();}
  fail(error){this.error=error;this.#wake();}
  readLine(max){return this.#wait({kind:'line',max});}
  readExactly(count){
    if(count===0)return Promise.resolve(Buffer.alloc(0));
    return this.#wait({kind:'bytes',count});
  }
  #wait(waiter){
    return new Promise((resolve,reject)=>{
      if(this.waiter){reject(Object.assign(new Error('传输读取重叠'),{statusCode:500}));return;}
      this.waiter={...waiter,resolve,reject};
      this.#wake();
    });
  }
  #wake(){
    const waiter=this.waiter;
    if(!waiter)return;
    if(this.error){this.waiter=null;waiter.reject(this.error);return;}
    if(waiter.kind==='line'){
      const at=this.#findNewline(waiter.max);
      if(at>=0){
        this.waiter=null;
        const line=this.#take(at);
        this.#take(1);
        waiter.resolve(line);
        return;
      }
      if(this.length>waiter.max||this.ended){
        this.waiter=null;
        waiter.reject(Object.assign(new Error(this.ended?'closed':'limit'),{code:this.ended?'CLOSED':'LIMIT'}));
      }
      return;
    }
    if(this.length>=waiter.count){this.waiter=null;waiter.resolve(this.#take(waiter.count));return;}
    if(this.ended){this.waiter=null;waiter.reject(Object.assign(new Error('closed'),{code:'CLOSED'}));}
  }
  #findNewline(max){
    let seen=0;
    for(const part of this.parts){
      if(seen>max)return -1;
      const window=Math.min(part.length,max-seen+1);
      const at=part.subarray(0,window).indexOf(0x0a);
      if(at>=0)return seen+at;
      if(window<part.length)return -1;
      seen+=part.length;
    }
    return -1;
  }
  #take(count){
    const out=Buffer.allocUnsafe(count);
    let filled=0;
    while(filled<count){
      const part=this.parts[0],need=count-filled;
      if(part.length<=need){part.copy(out,filled);filled+=part.length;this.parts.shift();}
      else{part.copy(out,filled,0,need);this.parts[0]=part.subarray(need);filled+=need;}
    }
    this.length-=count;
    return out;
  }
}

export function byteReadable(queue,length){
  let left=length,busy=false;
  return new Readable({
    async read(){
      if(busy)return;
      busy=true;
      try{
        while(left>0){
          const chunk=await queue.readExactly(Math.min(left,64*1024));
          left-=chunk.length;
          if(!this.push(chunk))return;
        }
        this.push(null);
      }catch(error){this.destroy(error);}
      finally{busy=false;}
    }
  });
}
