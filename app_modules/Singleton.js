class Singleton{

    constructor(){
        this.userConnections = {}
        this.userSockets = {}
        this.socketUsers = {}
    }
}

const instance = new Singleton()
Object.freeze(instance)

module.exports = {
    instance: instance
}