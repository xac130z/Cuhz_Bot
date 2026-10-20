import { publicStage } from './dto.mjs';
const encode = value => new TextEncoder().encode(value);
/** One heartbeat/poll timer regardless of subscriber count. No import timer. */
export function createStageStreams({read,heartbeatMs=10_000,maxClients=20,queueBytes=65_536}={}) {
  if(typeof read!=='function'||heartbeatMs<10||maxClients<1||queueBytes<1024) throw Error('STAGE_STREAM_CONFIG_INVALID');
  const clients=new Set(); let timer=null,epoch=0,polling=false;
  function remove(client) { clients.delete(client); try { client.controller.close(); } catch { /* already closed */ }
    client.detach?.(); if(!clients.size && timer){clearInterval(timer);timer=null;epoch++;} }
  function write(client,chunk) { if(client.controller.desiredSize < chunk.byteLength) return remove(client);
    try { client.controller.enqueue(chunk); } catch { remove(client); } }
  function deliver(client,snapshot) { const safe=publicStage(snapshot),body=JSON.stringify(safe);
    if(safe.version===client.version&&client.snapshot?.mode==='live_session'&&safe.mode==='live_session'
      &&Date.parse(safe.endsAt)>Date.parse(client.snapshot.endsAt))return;
    const fresh=Date.parse(safe.freshUntil);
    const restrictive=safe.mode==='hold'||(client.snapshot?.artwork&&!safe.artwork)||(client.snapshot?.activity&&!safe.activity)
      ||(safe.mode==='live_session'&&Date.parse(safe.endsAt)<Date.parse(client.snapshot?.endsAt));
    if(safe.version<client.version||(safe.version===client.version&&Number.isFinite(fresh)&&fresh<client.fresh&&!restrictive)||body===client.body) return;
    client.version=safe.version;client.body=body;client.snapshot=safe;
    if(Number.isFinite(fresh))client.fresh=fresh;
    write(client,encode(`id: ${safe.version}\nevent: snapshot\ndata: ${body}\n\n`)); }
  function publish(snapshot) { for(const client of clients) deliver(client,snapshot); }
  async function poll() { if(polling||!clients.size)return; const current=epoch;polling=true;
    try { const snapshot=await read(); if(current!==epoch)return;publish(snapshot);
      for(const client of clients)write(client,encode(': heartbeat\n\n'));
    // Availability failure is not an authoritative hold/version. Close so the
    // client clears the image and can recover the same version on a fresh read.
    } catch { if(current===epoch)for(const client of [...clients])remove(client); }
    finally {polling=false;} }
  async function connect(signal) {
    if(clients.size>=maxClients)throw Error('STAGE_STREAM_CAPACITY');
    const current=epoch,snapshot=await read();
    if(signal?.aborted||current!==epoch)throw Error('STAGE_STREAM_STOPPED');
    if(clients.size>=maxClients)throw Error('STAGE_STREAM_CAPACITY');
    let client;
    const stream=new ReadableStream({start(controller){client={controller,version:-1,fresh:0,body:null,detach:null};clients.add(client);
      const abort=()=>remove(client);signal?.addEventListener('abort',abort,{once:true});client.detach=()=>signal?.removeEventListener('abort',abort);
      write(client,encode('retry: 2000\n\n'));deliver(client,snapshot);
      if(!timer){timer=setInterval(poll,heartbeatMs);timer.unref?.();}
    },cancel(){remove(client);}},new ByteLengthQueuingStrategy({highWaterMark:queueBytes}));
    return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'}});
  }
  function stop(){epoch++;for(const client of [...clients])remove(client);if(timer){clearInterval(timer);timer=null;}}
  return Object.freeze({connect,publish,stop,count:()=>clients.size});
}
