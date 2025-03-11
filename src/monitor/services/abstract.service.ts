// abstract.service.ts

import EventEmitter from "events";
import { ServiceManager } from "../managers/Service.manager";

/* ######################################################### */


export class ServiceAbstract extends EventEmitter {
    protected serviceManager: ServiceManager;
    protected status: 'stopped' | 'starting' | 'started' | 'stopping' = 'stopped';
    protected intervals: Record<string, NodeJS.Timeout | null> = {};
    protected timeouts: Record<string, NodeJS.Timeout | null> = {};


    constructor(serviceManager: ServiceManager) {
        super();
        this.serviceManager = serviceManager;
    }


    start() {
        if (this.status !== 'stopped') return;
        this.status = 'starting';
    }


    started() {
        if (this.status !== 'starting') return;
        this.status = 'started';

        this.success(`Service ${this.constructor.name} démarré`);
        this.emit('service_started');
    }


    stop() {
        if (this.status !== 'started') return;
        this.status = 'stopping';

        Object.values(this.intervals).forEach(interval => interval && clearInterval(interval));
        Object.values(this.timeouts).forEach(timeout => timeout && clearInterval(timeout));
    }


    stopped() {
        if (this.status !== 'stopping') return;
        this.status = 'stopped';

        this.warn(`Service ${this.constructor.name} arrêté`);
        this.emit('service_stopped');
    }


    get getStatus() {
        return this.status;
    }


    log(message: string) {
        this.emit('log', message);
    }

    notice(message: string) {
        this.emit('notice', message);
    }

    success(message: string) {
        this.emit('success', message);
    }

    warn(message: string) {
        this.emit('warn', message);
    }

    error(message: string) {
        this.emit('error', message);
    }

    get db() {
        return this.serviceManager.getService("Database");
    }

    get listener() {
        return this.serviceManager.getService("PumpListener");
    }

    get tokenManager() {
        return this.serviceManager.getService("TokenManager");
    }

    get tokenAnalyzer() {
        return this.serviceManager.getService("TokenAnalyzer");
    }

    get priceFeed() {
        return this.serviceManager.getService("PriceFeed");
    }

    get portfolio() {
        return this.serviceManager.getService("PortfolioManager");
    }

    get trading() {
        return this.serviceManager.getService("TradingManager");
    }

    get systemMonitor() {
        return this.serviceManager.getService("SystemMonitor");
    }

    get indexer() {
        return this.serviceManager.getService("PumpFunIndexer");
    }

}


