const fs= require('fs');
const Buffer = require('buffer').Buffer;
const torrentParser=require('./metainfoParser');
const config=require('./config');
const torrent = torrentParser.parse(fs.readFileSync(config.TORRENTPATH));
console.log(torrent);
const tracker=require('./tracker');
const downloader = require('./downloader');
const fileManager = require('./fileManager');
const downloadPath=config.DOWNLOADDIR + torrent.md5 + '.mtr';

// if(!fs.existsSync(downloadPath)){
//     fs.writeFileSync(downloadPath, Buffer.alloc(torrent.size),()=>{});
// }else if(fs.readFileSync(downloadPath).length!=torrent.size){
//     fs.writeFileSync(downloadPath, Buffer.alloc(torrent.size),()=>{});
// }

fileManager.init(torrent, (fm) =>{

    downloader.initDownload(torrent, fm);
    tracker.getPeers(torrent,(peers)=>{
        console.log(peers);
        downloader.addPeers(peers);
    })
});


/* ToDo:
-bitfield file validation                       X
-save file selection
-peer reconnection
-Selective file download                        X
-end game
-File parsing after download
-peer protocol validation
-piece validation                               
-magnet link support by metadata extension
-http tracker support
-nested directories
-send the requested piece to the back of the list in the peer object, so incase of failure it would be download last by that peer
*/

