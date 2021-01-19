const fs= require('fs');
const Buffer = require('buffer').Buffer;
const torrentParser=require('./metainfoParser');
const config=require('./config');
const torrent = torrentParser.parse(fs.readFileSync('DS.torrent'));
console.log(torrent);
const tracker=require('./tracker');
const downloader = require('./downloader')
if(!fs.existsSync(config.DOWNLOADPATH)){
    fs.writeFileSync(config.DOWNLOADPATH, Buffer.alloc(torrent.size),()=>{});
}else if(fs.readFileSync(config.DOWNLOADPATH).length!=torrent.size){
    fs.writeFileSync(config.DOWNLOADPATH, Buffer.alloc(torrent.size),()=>{});
}

tracker.getPeers(torrent,(peers)=>{
    console.log(peers);
    downloader.download(torrent,peers);
})

//console.log(url);
// const socket=dgram.createSocket('udp4');
// const myMsg=Buffer.from('hello?','utf8');
// socket.send(myMsg,0,myMsg.length,url.port,url.host,()=>{});
// socket.on('message',msg=>{
//     console.log('message is: ',msg);
// }) 