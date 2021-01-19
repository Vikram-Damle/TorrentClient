const bencode=require('bencode');
const crypto=require('crypto');

module.exports.parse=(torrentFile)=>{
    const torrent = bencode.decode(torrentFile);
    console.log(torrent.info.files);
    let res= new Object();
    res.announce=torrent.announce.toString('utf8');
    res.announceList=new Array();
    torrent['announce-list'].forEach(element => {
        res.announceList.push(element.toString('utf8'));
    });
    if(torrent['created by'])res.created_by=torrent['created by'].toString('utf8');
    //seconds passed since the UNIX epoch
    res.creation_date=torrent['creation date'];
    //res.encoding=torrent.encoding.toString('utf8');
    const info = bencode.encode(torrent.info);
    res.infoHash = crypto.createHash('sha1').update(info).digest();
    console.log('infoHash' , res.infoHash)
    const size=torrent.info.files ?
                    torrent.info.files.map(file => file.length).reduce((a, b) => a + b) :
                    torrent.info.length;
    res.size=size;
    res.pieceCount=torrent.info.pieces.length/20;
    res.pieceHash= new Array();
    for(i=0; i<res.pieceCount; i++){
        res.pieceHash.push(torrent.info.pieces.slice(i*20,(i+1)*20));
    }
    res.pieceLength=torrent.info['piece length'];
    res.filename=torrent.info.name.toString('utf8');
    return res;
}