const bencode=require('bencode');
const crypto=require('crypto');

/* Parses the metainfo file */
module.exports.parse=(torrentFile)=>{
    /* the metainfo file is bencode encoded */
    const torrent = bencode.decode(torrentFile);
    let res= new Object();

    res.announce=torrent.announce.toString('utf8');

    res.announceList=new Array();
    torrent['announce-list'].forEach(element => {
        res.announceList.push(element.toString('utf8'));
    });

    if(torrent['created by'])res.created_by=torrent['created by'].toString('utf8');
    
    /* seconds passed since the UNIX epoch */
    res.creation_date=torrent['creation date'];

    /* create the info hash; acts like a unique ID for the torrent */
    const info = bencode.encode(torrent.info);
    res.infoHash = crypto.createHash('sha1').update(info).digest();

    const size=torrent.info.files ?
                    torrent.info.files.map(file => file.length).reduce((a, b) => a + b) :
                    torrent.info.length;
    res.size=size;

    res.pieceCount=torrent.info.pieces.length/20;

    /* Individual piece hashes; stored as concatenated 20 Byte array in the metainfo file info.pieces property;
    Required to verify the integrity of the downloaded piece*/
    res.pieceHash= new Array();
    for(i=0; i<res.pieceCount; i++){
        res.pieceHash.push(torrent.info.pieces.slice(i*20,(i+1)*20));
    }

    res.pieceLength=torrent.info['piece length'];

    res.filename=torrent.info.name.toString('utf8');
    if(torrent.info.files){
        res.files=new Array();
        torrent.info.files.forEach((file)=>{
            res.files.push({size: file.length, path: file.path.toString('utf8').split(',').join('/')});
        })
    }

    /* used to name the relevant temp files */
    res.md5=crypto.createHash('md5').update(res.infoHash).digest().toString('hex');
    
    return res;
}