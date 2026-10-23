import { dependencyErrorDetails } from './dependency-diagnostics.js';

export function createShutdown(server:{close(callback:()=>void):unknown},cleanup:()=>Promise<unknown>,
  options:{exit:(code:number)=>void;timeoutMs?:number}) {
  let stopping=false;
  return (reason:string,exitCode=0) => {
    if(stopping)return;stopping=true;
    const safeReason=['SIGINT','SIGTERM','server_error','uncaught_exception','unhandled_rejection'].includes(reason)?reason:'shutdown';
    console.info(JSON.stringify({event:'shutdown_started',reason:safeReason}));
    const deadline=setTimeout(()=>{console.error(JSON.stringify({event:'shutdown_timeout'}));options.exit(1);},options.timeoutMs??8000);
    // Keep the deadline referenced: a stuck cleanup Promise alone does not keep
    // Node alive, and must not turn a failed shutdown into a silent exit(0).
    server.close(()=>{
      void Promise.resolve().then(cleanup).catch(error=>{
        exitCode=1;console.error(JSON.stringify({event:'shutdown_cleanup_failed',...dependencyErrorDetails(error)}));
      }).finally(()=>{
        clearTimeout(deadline);console.info(JSON.stringify({event:'shutdown_completed',exitCode}));options.exit(exitCode);
      });
    });
  };
}
