/** Existing host minute timer owns bounded retention. No timer on import and
 * no overlapping physical query after a timeout or stop/start transition. */
export function createChainCleanup({query,enabled=false,timeoutMs=6000}={}) {
  if(typeof query!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('CHAIN_CLEANUP_CONFIG_INVALID');
  let active=false,flight=null,epoch=0;
  return Object.freeze({start(ready){if(enabled===true&&ready===true&&!active){active=true;epoch++;}},stop(){active=false;epoch++;},
    async run(){
      if(!active||flight)return {ok:false,code:flight?'CHAIN_CLEANUP_BUSY':'CHAIN_CLEANUP_DISABLED'};
      const turn=epoch;let timer;
      const operation=Promise.resolve().then(()=>{if(!active||turn!==epoch)throw Error('stopped');return query('select public.lounge_chain_retention_cleanup($1) result',[64]);});
      flight=operation;const release=()=>{if(flight===operation)flight=null;};void operation.then(release,release);
      try {
        const value=await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),timeoutMs);})]);
        if(!active||turn!==epoch)return {ok:false,code:'CHAIN_CLEANUP_STOPPED'};
        const result=value?.rows?.[0]?.result;
        if(result?.ok===false&&Object.keys(result).length===2&&['CHAIN_RETENTION_DISABLED','INVALID_REQUEST','ISOLATION_UNSUPPORTED'].includes(result.code))return {ok:false,code:result.code};
        if(!result||Object.keys(result).length!==4||result.ok!==true||typeof result.hasMore!=='boolean'||result.removedAssets+result.removedReceipts>64||!['removedAssets','removedReceipts'].every(k=>Number.isSafeInteger(result[k])&&result[k]>=0&&result[k]<=64))throw Error('invalid');
        return result;
      }catch{return {ok:false,code:'CHAIN_CLEANUP_UNAVAILABLE'};}
      finally{clearTimeout(timer);}
    }});
}
