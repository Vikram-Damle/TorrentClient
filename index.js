const fs= require('fs');
const Buffer = require('buffer').Buffer;
const torrentParser=require('./metainfoParser');
const config=require('./config');
const torrent = torrentParser.parse(fs.readFileSync('files/DS.torrent'));
console.log(torrent);
const tracker=require('./tracker');
const downloader = require('./downloader')
if(!fs.existsSync(config.DOWNLOADPATH)){
    fs.writeFileSync(config.DOWNLOADPATH, Buffer.alloc(torrent.size),()=>{});
}else if(fs.readFileSync(config.DOWNLOADPATH).length!=torrent.size){
    fs.writeFileSync(config.DOWNLOADPATH, Buffer.alloc(torrent.size),()=>{});
}
downloader.initDownload(torrent);
tracker.getPeers(torrent,(peers)=>{
    console.log(peers);
    downloader.addPeers(peers);
})
