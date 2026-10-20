/** The fragment never reaches the HTML request or referrer. Only the fixed
 * same-origin OBS stream receives this scoped read-only capacity token. */
export function stageStreamPath({pathname,hash='',search=''}={}) {
 if(pathname!=='/stage/obs')return '/stage/stream';
 if(search||typeof hash!=='string'||hash.length>780||!hash.startsWith('#'))throw Error('STAGE_OBS_ACCESS_REQUIRED');
 const entries=[...new URLSearchParams(hash.slice(1))];
 if(entries.length!==1||entries[0][0]!=='token'||entries[0][1].length>768||!/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(entries[0][1]))throw Error('STAGE_OBS_ACCESS_REQUIRED');
 return '/stage/obs/stream?token='+encodeURIComponent(entries[0][1]);
}

/** One EventSource with bounded reconnect backoff and a silent-stream watchdog.
 * This transport only reads public snapshots. It never retries a mutation/job. */
export function createStageFeed({createSource,onSnapshot,onUnavailable,setTimer=setTimeout,clearTimer=clearTimeout,stallMs=25000}={}){
 if(typeof createSource!=='function'||typeof onSnapshot!=='function'||typeof onUnavailable!=='function')throw Error('STAGE_FEED_CONFIG');
 let source=null,retry=null,watchdog=null,stopped=true,epoch=0,attempt=0;
 function clear(){if(retry!==null)clearTimer(retry);retry=null;if(watchdog!==null)clearTimer(watchdog);watchdog=null;}
 function disconnect(){source?.close();source=null;}
 function schedule(){if(stopped||retry!==null)return;const delay=Math.min(1000*2**Math.min(attempt++,4),10000);retry=setTimer(()=>{retry=null;open();},delay);}
 function failed(run){if(stopped||run!==epoch)return;onUnavailable();if(watchdog!==null)clearTimer(watchdog);watchdog=null;disconnect();epoch++;schedule();}
 function arm(run){if(watchdog!==null)clearTimer(watchdog);watchdog=setTimer(()=>failed(run),stallMs);}
 function open(){if(stopped)return;disconnect();const run=++epoch;let next;
  try{next=createSource();}catch{failed(run);return;}source=next;arm(run);
  next.addEventListener('snapshot',event=>{if(stopped||run!==epoch||source!==next)return;try{const snapshot=JSON.parse(event.data);onSnapshot(snapshot);attempt=0;arm(run);}catch{failed(run);}});
  next.onerror=()=>{if(stopped||run!==epoch)return;onUnavailable();
   // A permanently CLOSED source (including non-200/wrong MIME) never retries itself.
   if(next.readyState===2)failed(run);
  };
 }
 return Object.freeze({start(){if(!stopped)return;stopped=false;attempt=0;open();},stop(){stopped=true;epoch++;clear();disconnect();}});
}
