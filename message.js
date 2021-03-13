const Buffer=require('buffer').Buffer
const utils=require('./utils');

module.exports.Handshake=(torrent)=>{
    const buf = Buffer.alloc(68);
    //protocol string length 1byte
    buf.writeUInt8(19);
    //protocol string 19bytes
    buf.write('BitTorrent protocol',1,'utf8');
    //reserved 8bytes
    utils.writeBigUInt64BE(buf,0n,20);
    //infoHash 20bytes
    torrent.infoHash.copy(buf,28);
    //peerID 20bytes
    utils.generateId().copy(buf,48);
    //<pstrlen><pstr><reserved><info_hash><peer_id></peer_id>
    return buf;
}

module.exports.parseHandshake=(data)=>{
    let res={};
    res.pstrlen=data.readUInt8(0);
    res.pstr=data.toString('utf-8',1,1+res.pstrlen);
    res.reserved=data.slice(1+res.pstrlen,9+res.pstrlen);
    res.infoHash=data.slice(9+res.pstrlen,9+res.pstrlen+20);
    res.peerID=data.slice(9+res.pstrlen+20,9+res.pstrlen+40);
    return res;
}

module.exports.KeepAlive=()=>{
    const buf = Buffer.alloc(4);
    //<len=0000>
    return buf;
}

module.exports.Choke=()=>{
    const buf = baseMessage(1,0);
    //<len=0001><id=0>
    return buf;
}

module.exports.Unchoke=()=>{
    const buf = baseMessage(1,1);
    //<len=0001><id=1>
    return buf;
}

module.exports.Interested=()=>{
    const buf = baseMessage(1,2);
    //<len=0001><id=2>
    return buf;
}

module.exports.NotInterested=()=>{
    const buf = baseMessage(1,3);
    //<len=0001><id=3>
    return buf;
}

module.exports.Have=(piece_index)=>{
    const buf = baseMessage(5,4);
    //piece index
    buf.writeUInt32BE(piece_index);
    //<len=0005><id=4><piece index>
    return buf;
}

module.exports.Bitfield=(bitfield)=>{
    const size=bitfield.length;
    const buf = baseMessage(1+size,5);
    //bitfield
    bitfield.copy(buf,5);
    //<len=0001+X><id=5><bitfield>
    return buf;
}

module.exports.Request=(index,begin,length)=>{
    const buf = baseMessage(13,6);
    //index
    buf.writeUInt32BE(index,5);
    //begin
    buf.writeUInt32BE(begin,9);
    //length
    buf.writeUInt32BE(length,13);
    //<len=0013><id=6><index><begin><length>
    return buf;
}

module.exports.Piece=(index,begin,block)=>{
    const size=block.length;
    const buf = baseMessage(9+size,7);
    //index
    buf.writeUInt32BE(index,5);
    //begin
    buf.writeUInt32BE(begin,9);
    //block
    block.copy(buf,13);
    //<len=0009+X><id=7><index><begin><block>
    return buf;
}

module.exports.Cancel=(index,begin,length)=>{
    const buf = baseMessage(13,8);
    //index
    buf.writeUInt32BE(index,5);
    //begin
    buf.writeUInt32BE(begin,9);
    //length
    buf.writeUInt32BE(length,13);
    //<len=0013><id=8><index><begin><length>
    return buf;
}

module.exports.Port=(port)=>{
    const buf = baseMessage(3,9);
    //port
    buf.writeUInt16BE(port,5);
    //<len=0003><id=9><listen-port>
    return buf;
}

function baseMessage(len,id){
    const buf = Buffer.alloc(len+4);
    //len
    buf.writeUInt32BE(len);
    //id
    buf.writeUInt8(id,4);
    return buf;
}


function isHandshake(data){
    if(data.length<4)return false;
    if(data.readUInt8(0)+49 == data.length)return true;
}
module.exports.isHandshake = isHandshake;

module.exports.parse=function parseMessage(msg){
    if(isHandshake(msg) || msg.length<4)return;
    let len = msg.readUInt32BE(0);
    if(len+4!=msg.length)return;
    let parsed={len: len};
    let id=-1;
    if(len)id = msg.readUInt8(4);
    if(id!=-1)parsed.id=id;
    if(id==4)parsed.pieceIndex=msg.readUInt32BE(5);
    else if(id==5)parsed.bitfield=msg.slice(5);
    else if(id>5 && id<9){
        parsed.index=msg.readUInt32BE(5);
        parsed.begin=msg.readUInt32BE(9);
    }
    if(id==6 || id==8)parsed.blockLen=msg.readUInt32BE(13);
    if(id==7)parsed.block=msg.slice(13);
    if(id==9)parsed.listenPort=msg.readUInt32BE(5);
    return parsed;
}

