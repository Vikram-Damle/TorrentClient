module.exports = {

    /*================================USER SETTINGS=============================== */
    /**
     * 0: OFF
     * 1: console
     * 2: browser console
     */
    LOG_MODE: [1],

    /**
     * Download directory for the torrent;
     * PLEASE APPEND / (frontslash)
     */
    DOWNLOAD_DIR: 'files/',



    /*===================================DEV CONFIG===================================*/

    /* DO NOT CHANGE */
    /**
     * port used to connect to trackers
     * typically, but not necessarily, 6881-6889
     * */
    PORT: 6885,
    /**
     * size of a block (unit of data transfer)
     */
    BLOCK_LENGTH: Math.pow(2,14),
    /**
     * Max number of peers allowed to concurrently download the same piece
     */
    MAX_PIECE_SEEDS: 3,


    /* Change in case there is port conflicts with other programs.*/
    /**
     * Client UI server port
     */
    UI_HTTP_PORT: 9495,
    /**
     * Client UI Websocket port 
     */ 
    UI_WS_PORT: 9494,
}