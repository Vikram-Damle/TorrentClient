const Bitfield = require('./utils').Bitfield;
const fs = require('fs');
const utils = require('./utils');
const config = require('./config');

/** The File Manager Class. Handles all file IO.*/
class FileManager{
    /**
     * 
     * @param {Object} torrent - object holding the metainfo of the torrent
     * @param {Bitfield} toDl - bitfield storing the pieces to download
     * @param {Number} bfFile - descriptor to file storing downloaded pieces bitfield
     * @param {Bitfield} bf - downloaded pieces bitfield
     * @param {Object} fileToWrite - object mapping pieces to file desciptors
     * @param {Bitfield} filesToDl - bitfield storing the files to download. Indices are in accodance to the metainfo.
     * @param {Array} paths - paths to the temp files
     * @param {Object} fileDescriptors - object mapping file paths to file descriptors of the temp files
     */

    constructor(torrent, toDl, bfFile, bf, fileToWrite, filesToDl, paths, fileDescriptors){
        this.torrent = torrent;
        this.toDl = toDl;
        this.bfFile = bfFile;
        this.bitfield = bf;
        this.fileToWrite = fileToWrite;
        this.filesToDl = filesToDl;
        this.paths = paths;
        this.fileDescriptors = fileDescriptors;
    }

    /**
     * Write the piece to the corresponding temp file(s)
     * @param {Number} piece - piece indx 
     * @param {Buffer} pieceData - piece data buffer 
     */
    writePiece(piece,pieceData){
        /* Do nothing if piece is not to be downloaded*/
        if(!this.toDl.get(piece))return null;

        const files = this.fileToWrite[piece];
        files.forEach((file) => {
            let offset=0;
            /* piece offset in a temp file = number of piece in the file preceding the piece * piece length */
            for(let i=0; i<piece; i++){
                if(this.fileToWrite[i] && this.fileToWrite[i].includes(file))
                    offset+=this.torrent.pieceLength;
            }
            fs.writeSync(file,pieceData,0,pieceData.length,offset);

        })
      
    };
    
    /**
     * Update the dowloaded pieces bitfield file
     * @param {Bitfield} bitfield 
     */
    updateBitfield(bitfield){
        fs.writeSync(this.bfFile,bitfield.buffer,0,bitfield.buffer.length,0);
    };

    /**
     * Parse the downloaded temp files into readable files
     */
    parseFiles(){
        utils.log("Parsing the files...");
        if(!this.torrent.files){
            /* If single file, just slice the end to the file size */
            let data=Buffer.alloc(this.torrent.size);
            fs.readSync(this.fileToWrite[0][0],data,0,data.length,0);
            fs.writeFileSync(config.DOWNLOAD_DIR + this.torrent.filename, data);
        }
        else{
            let prefSize = 0;
            this.torrent.files.forEach((file,ind)=>{
                if(this.filesToDl.get(ind)){
                    /* temp buffer for copying data */
                    let data = Buffer.alloc(file.size);
                    /* offset of file data in the temp file */
                    let offset=prefSize%this.torrent.pieceLength;
                    fs.readSync(this.fileDescriptors[file.path], data, 0, data.length, offset);

                    /*create the required sub directories for the file path */
                    createSubDirs(config.DOWNLOAD_DIR + this.torrent.filename + '/' + file.path);

                    fs.writeFileSync(config.DOWNLOAD_DIR + this.torrent.filename + '/' + file.path, data);
                }
                prefSize+=file.size;
            });
        }
        
        utils.log("removing temp files...");
        /* close all the open files */
        let fds=new Set();
        for (const [piece, fd] of Object.entries(this.fileDescriptors)) {
            fds.add(fd);
        }
        fds.forEach((fd)=>{
            fs.closeSync(fd);
        });
        fs.closeSync(this.bfFile);

        /* remove all the temp files */
        this.paths.forEach((path,ind)=>{
            utils.log('Deleting '+path);
            fs.unlinkSync(path);
        })
        
        utils.log("Finished!");
    };
};




/**
 * (Create and) Open the required temp files
 * @param {Bitfield} fileBitField 
 * @param {Object} torrent
 * @param {Array} paths
 * @param {Object} fileDescriptors
 * @param {Object} fileToWrite
 */
function createFiles(fileBitField, torrent, paths, fileDescriptors, fileToWrite){
    let dir=config.DOWNLOAD_DIR;
    if(torrent.files){
        dir = dir + torrent.filename + '/';
        /* Create the root directory, if does not exist */ 
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir);
        }

        prefSum = 0;

        torrent.files.forEach((file, index) => {
            /* Create a unique temp file, named as (md5 hash of torrent)_(file index).mtr 
            temp files are conglomeration of minimal set of pieces containing the actual file
            */
            const path = dir + torrent.md5 + '_' + index + '.mtr';
            prefSum += file.size;

            /* Delete the temp file, if not required but already exists */
            if(!fileBitField.get(index)) {
                if(fs.existsSync(path)) {
                    fs.unlinkSync(path)
                }
                return;
            }
            /* Create and open the temp file */
            if(!fs.existsSync(path)) {
                fs.writeFileSync(path, Buffer.alloc(file.size));
            }
            const t = openOverwrite(path);
            paths.push(path);
            fileDescriptors[file.path] = t;
            
            /* Update fileToWrite. The temp file contains piece indices between begin and end */
            const begin = Math.floor((prefSum -file.size) / torrent.pieceLength);
            const end = 1 + Math.floor(prefSum / torrent.pieceLength);
            //i<=end ????
            for(let i = begin; i <= end; i++) {
                if(fileToWrite[i] && fileToWrite[i].length > 0) {
                    fileToWrite[i].push(t);
                } else {
                    fileToWrite[i] = [t];
                }
            }
        })
    }
    else{
        /* Single file case */
        let path = dir + torrent.md5 + '.mtr';
        if(!fs.existsSync(path))
            fs.writeFileSync(path, Buffer.alloc(torrent.size));
        let t=openOverwrite(path);
        paths.push(path);
        for(let k=0; k<torrent.pieceCount; k++){
            fileToWrite[k]=[t];
        }
    }

};

/**
 * (Create and) Open the bitfield file
 */
function createBitfieldFile(torrent, paths){
    let bitfieldPath = config.DOWNLOAD_DIR;
    let bitfield, bfFile;
    if(torrent.files){
        bitfieldPath = bitfieldPath + torrent.filename + '/';
        if(!fs.existsSync(bitfieldPath)){
            fs.mkdirSync(bitfieldPath);
        }
    }
    
    bitfieldPath = bitfieldPath + torrent.md5 + '.bfd'

    if(fs.existsSync(bitfieldPath)){
        bitfield= Bitfield.fromBuffer(fs.readFileSync(bitfieldPath),torrent.pieceCount);
    }else{
        bitfield= new Bitfield(torrent.pieceCount);
        fs.writeFileSync(bitfieldPath,bitfield.buffer);
    }

    bfFile=openOverwrite(bitfieldPath);
    paths.push(bitfieldPath);

    return [bitfield, bfFile];
}


/** 
 * Creates new file and copies all data of the old file into it.
 * Only called once existence of the file has been verified.
 */
function openOverwrite(path){
    let oldData=fs.readFileSync(path);
    let fd=fs.openSync(path, 'w+'); 
    fs.writeSync(fd,oldData);
    return fd;
}

/**
 * Create the subdirectories involved in the path, if does not exist
 * @param {String} path 
 */
function createSubDirs(path){
    let dir = path.split('/');
    dir.pop();
    if(dir.length){
        dir=dir.join('/');
        fs.mkdirSync(dir,{recursive:true});
    }
}

/**
 * Format and print the file list and sizes in console;
 * Send the file list to the UI 
 * @param {Object} torrent - torrent metainfo object
 * @param {WebSocket} ws - the WebSocket connection with front end UI
 */
 module.exports.printFiles = function printFiles(torrent, ws){
    let filedets = [];
    if(torrent.files){
        /* calculating max filename column length */
        let mxNameLen=0;
        torrent.files.forEach((ele=>{mxNameLen=Math.max(mxNameLen,ele.path.length);}));
        mxNameLen = Math.ceil(mxNameLen/8)*8;

        torrent.files.forEach((ele,ind) => {
            let name = (ind+1) + '. ' + ele.path;

            /* adding appropriate padding */
            let padding='';
            for(var i=0;i<Math.ceil((mxNameLen-name.length)/8);i++)padding+='\t';

            filedets.push({name:ele.path,size:(ele.size/1048576).toFixed(2) + 'MB'});
        });
    }
    else{
        filedets.push({name:torrent.filename,size:(torrent.size/1048576).toFixed(2) + 'MB'})
    }
    /* Send the list to front end UI */
    ws.send(JSON.stringify({type:'file-list',data:filedets}));
}

/**
 * Handle the file selection
 * @param {String} inp - space separated file indices 
 * @param {Object} torrent - metainfo object 
 * @param {Function} callback - callback after selection
 */
module.exports.handelSelection = function handleSelection(inp, torrent, callback){
    /* see FileManager constructor definition */
    let toDl;
    let bfFile;
    let bitfield;
    let fileToWrite = new Object();
    let fileDescriptors = new Object();
    let paths = new Array();
    
    /*Create the download directory, if does not exist */
    createSubDirs(config.DOWNLOAD_DIR);

    [bitfield,bfFile] = createBitfieldFile(torrent, paths);

    if(torrent.files){
        /*parse the input string */
        let sel;
        if(inp=='*') sel = Array.from({length: torrent.files.length}, (_, i) => i + 1);
        else sel = inp.trim().split(' ').map((ele)=>parseInt(ele));
        
        /* Calculate the piece indices that need to be downloaded */
        let prefSum = new Array();
        prefSum.push(0);
        torrent.files.forEach((ele,ind)=>{
            prefSum[ind+1]=prefSum[ind] + ele.size;
        })
        toDl= new Set();
        sel.forEach((ele)=>{
            let beg = Math.floor(prefSum[ele-1]/torrent.pieceLength);
            let end = Math.floor((prefSum[ele-1]+torrent.files[ele-1].size)/torrent.pieceLength);
            for( var i = beg; i<=end; i++)toDl.add(i+1);
        })
        let bf = Bitfield.fromArray(toDl,torrent.pieceCount);
        toDl=bf;


        let filesToDl = Bitfield.fromArray(sel,torrent.files.length);

        /*Create the temp files*/
        createFiles(filesToDl, torrent, paths, fileDescriptors, fileToWrite); 
        utils.log("temp files created...");

        /*Create the file manager object for the downloader to use */
        let fm = new FileManager(torrent, toDl, bfFile, bitfield, fileToWrite, filesToDl, paths, fileDescriptors);

        callback(fm);

    }else{
        /* Calculate the piece indices that need to be downloaded. Here, all indices. */
        toDl = new Bitfield(torrent.pieceCount);
        for(let i=0; i < toDl.length; i++)toDl.set(i);
        const filesToDl = Bitfield.fromArray([1], 1);

        createFiles(filesToDl, torrent, paths, fileDescriptors, fileToWrite);
        utils.log("temp files created...");

        let fm = new FileManager(torrent, toDl, bfFile, bitfield, fileToWrite, null, paths, fileDescriptors);

        callback(fm);

    }
}