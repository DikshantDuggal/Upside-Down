import {createServer} from './index.ts';
const port=Number(process.env.PORT??4050),host=process.env.UD_HOST??'127.0.0.1';
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT');
const instance=createServer();
const server=instance.app.listen(port,host,()=>console.log(`Upside-Down backend listening on ${host}:${port}. GitHub remains authoritative for connected mission communication.`));
let stopping=false;
const stop=()=>{if(stopping)return;stopping=true;instance.executionPipeline.stop();server.closeAllConnections();server.close(()=>{instance.db.close();process.exit(0);});};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
