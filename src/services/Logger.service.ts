// Logger.service.ts

import fs from "fs";

import { ServiceAbstract } from "./abstract.service";
import { getUsDateTime } from "../lib/utils/time.util";


/* ######################################################### */


type WatchedService = {
    listening: boolean,
    onServiceLog: (message: string) => void | null,
    onServiceNotice: (message: string) => void | null,
    onServiceSuccess: (message: string) => void | null,
    onServiceWarn: (message: string) => void | null,
    onServiceError: (message: string) => void | null,
}


/* ######################################################### */

const logDir = '/tmp/pumpmonitor';

/* ######################################################### */


export class Logger extends ServiceAbstract {
    watchedService: Map<ServiceAbstract, WatchedService> = new Map;


    start() {
        if (this.status !== 'stopped') return;
        super.start();

        if (! fs.existsSync(logDir)) {
            fs.mkdirSync(logDir);
        }

        this.watch(Array.from(this.watchedService.keys()));

        super.started();
    }


    stop() {
        if (this.status !== 'started') return;
        super.stop();

        this.unwatch(Array.from(this.watchedService.keys()));

        super.stopped();
    }


    watch(services: ServiceAbstract[]) {
        for (const service of services) {
            let serviceInfos = this.watchedService.get(service)
            if (serviceInfos?.listening) continue;

            if (!serviceInfos) {
                const onServiceLog = (message: string) => {
                    this.displayConsole(service, 'log', message);
                    this.writeToFile(service, 'log', message);
                }

                const onServiceNotice = (message: string) => {
                    this.displayConsole(service, 'notice', message);
                    this.writeToFile(service, 'notice', message);
                }

                const onServiceSuccess = (message: string) => {
                    this.displayConsole(service, 'success', message);
                    this.writeToFile(service, 'success', message);
                }

                const onServiceWarn = (message: string) => {
                    this.displayConsole(service, 'warn', message);
                    this.writeToFile(service, 'warn', message);
                }

                const onServiceError = (message: string) => {
                    this.displayConsole(service, 'error', message);
                    this.writeToFile(service, 'error', message);
                }

                this.watchedService.set(service, { listening: false, onServiceLog, onServiceNotice, onServiceSuccess, onServiceWarn, onServiceError })
            }

            if (this.status === 'started' || this.status === 'starting') {
                serviceInfos = this.watchedService.get(service);

                if (serviceInfos) {
                    //console.log(`Démarrage de l'écoute des logs pour le service ${service.constructor.name}...`)

                    service.on('log', serviceInfos.onServiceLog);
                    service.on('notice', serviceInfos.onServiceNotice);
                    service.on('success', serviceInfos.onServiceSuccess);
                    service.on('warn', serviceInfos.onServiceWarn);
                    service.on('error', serviceInfos.onServiceError);
                    serviceInfos.listening = true;
                }
            }
        }
    }


    unwatch(services: ServiceAbstract[]) {
        for (const service of services) {
            const serviceInfos = this.watchedService.get(service)
            if (!serviceInfos) continue;

            //console.log(`Arrêt de l'écoute des logs pour le service ${service.constructor.name}...`)

            service.off('log', serviceInfos.onServiceLog);
            service.off('notice', serviceInfos.onServiceNotice);
            service.off('success', serviceInfos.onServiceSuccess);
            service.off('warn', serviceInfos.onServiceWarn);
            service.off('error', serviceInfos.onServiceError);

            serviceInfos.listening = false;
            this.watchedService.delete(service);
        }
    }


    private displayConsole(service: ServiceAbstract, severity: 'log' | 'notice' | 'success' | 'warn' | 'error', message: string) {

        const now = function (date?: Date) {
            return (date ?? new Date).toLocaleTimeString();
            return getUsDateTime(date).replace(' ', ' | ');
        }

        if (severity === 'error') {
            console.error(`${now()} | ${service.constructor.name} | ❌ ${message}`);

        } else if (severity === 'warn') {
            console.warn(`${now()} | ${service.constructor.name} | ⚠️ ${message}`);

        } else if (severity === 'success') {
            console.log(`${now()} | ${service.constructor.name} | ✅ ${message}`);

        } else if (severity === 'notice') {
            console.log(`${now()} | ${service.constructor.name} | 📢 ${message}`);

        } else {
            console.log(`${now()} | ${service.constructor.name} | ${message}`);
        }
    }


    private writeToFile(service: ServiceAbstract, severity: 'log' | 'notice' | 'success' | 'warn' | 'error', message: string) {
        const serviceName = service.constructor.name || 'pumpmonitor-unknown-service';
        let logFile = '';
        let serviceLogFile = '';
        let text = '';
        let fileExt = '';

        if (!logDir) return;


        const now = getUsDateTime;

        if (severity === 'error') {
            fileExt = 'error';
            text = `${now()} | ${service.constructor.name} | ❌ ${message}`;

        } else if (severity === 'warn') {
            fileExt = 'warn';
            text = `${now()} | ${service.constructor.name} | ⚠️ ${message}`;

        } else if (severity === 'success') {
            fileExt = 'log';
            text = `${now()} | ${service.constructor.name} | ✅ ${message}`;

        } else if (severity === 'notice') {
            fileExt = 'log';
            text = `${now()} | ${service.constructor.name} | 📢 ${message}`;

        } else {
            fileExt = 'log';
            text = `${now()} | ${service.constructor.name} | ${message}`;
        }

        if (!fileExt) return;
        if (!text) return;


        logFile = `${logDir}/pumpmonitor.${fileExt}`;
        fs.appendFileSync(logFile, text + '\n');

        serviceLogFile = `${logDir}/${serviceName}.${fileExt}`;
        fs.appendFileSync(serviceLogFile, text + '\n');
    }

}


