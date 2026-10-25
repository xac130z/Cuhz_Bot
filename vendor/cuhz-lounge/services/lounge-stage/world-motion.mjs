export const WORLD_ARRIVAL_MS=4200;
/** Public scenery only. The canonical presenter owns all content and authority.
 * One verified idle entrance per document; CSS owns the slow ambient loop.
 * No frame loop, artwork access, request, publication or progress estimate.
 */
export function createStageWorldMotion({enabled=false,onChange,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 if(typeof onChange!=='function')throw Error('STAGE_WORLD_MOTION_CONFIG');
 let view='connecting',mode=null,off=true,consumed=false,arriving=false,stopped=false,timer=null,epoch=0,cue=null;
 const idle=()=>enabled&&view==='idle'&&mode==='idle';
 function emit(next){if(cue!==next){cue=next;onChange(next);}}
 function cancel(){epoch++;if(timer!==null)clearTimer(timer);timer=null;arriving=false;}
 function settle(){if(!arriving)emit(!stopped&&!off&&idle()?'idle':'still');}
 function accept(nextView,snapshotMode){
  if(stopped)return;
  view=nextView;mode=snapshotMode;
  if(view==='connecting'){cancel();emit('still');return;}
  // Initial pause, review, an existing reveal or an unavailable connection must
  // not defer a theatrical entrance until some later return to idle.
  if(!consumed){
   consumed=true;
   if(!off&&idle()){
    arriving=true;emit('arriving');const run=epoch;
    timer=setTimer(()=>{if(stopped||run!==epoch)return;timer=null;arriving=false;settle();},WORLD_ARRIVAL_MS);
    return;
   }
  }
  if(off||!idle())cancel();
  settle();
 }
 function motion(isOff){if(stopped)return;off=Boolean(isOff);if(off)cancel();settle();}
 function stop(){if(stopped)return;stopped=true;cancel();emit('still');}
 emit('still');
 return Object.freeze({accept,motion,stop});
}
