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
-File parsing after download                    X
-bitfield file validation                       X
-piece validation                               X                       
-Selective file download                        X
-save file selection
-nested directories                             X
-remove temp files                              X
-end game                                       .
-last piece block                               X
-peer protocol validation                       X
-max simultaneous download of a piece
-cancel pieces if dled
-corrupt file loop
-http tracker support
-peer reconnection
-magnet link support by metadata extension
*/

