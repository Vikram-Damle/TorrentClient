const dgram=require('dgram');
const chalk=require('chalk');
var readline = require('readline');
 
var rl = readline.createInterface(
     process.stdin, process.stdout);
const socket=dgram.createSocket('udp4');
const name="kitsune94";
socket.bind(7777);
socket.on('message',(msg)=>{
    console.log(chalk.cyan(msg.toString('utf8')));
    process.stdout.write(">>> ")
})
rl.setPrompt(`>>> `);
rl.prompt();
rl.on('line', (msg) => {
    if(msg=='exit()')process.exit(1);
    socket.send(name+" : "+msg,7778,"localhost");
    process.stdout.write(">>> ")
});
return true;