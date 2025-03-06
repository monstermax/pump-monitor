// Logger.service.ts

import fs from "fs";

import { ServiceAbstract } from "./abstract.service";
import { getUsDateTime } from "../lib/utils/time.util";


/* ######################################################### */


type WatchedService = {
    listening: boolean,
    onServiceLog: (message: string) => void | null,
    onServiceNotice: (message: string) => void | null,
    onServiceWarn: (message: string) => void | null,
    onServiceError: (message: string) => void | null,
}


/* ######################################################### */

const logDir = '/tmp';

/* ######################################################### */


export class Logger extends ServiceAbstract {
    watchedService: Map<ServiceAbstract, WatchedService> = new Map;


    start() {
        if (this.status !== 'stopped') return;
        super.start();

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

                const onServiceWarn = (message: string) => {
                    this.displayConsole(service, 'warn', message);
                    this.writeToFile(service, 'warn', message);
                }

                const onServiceError = (message: string) => {
                    this.displayConsole(service, 'error', message);
                    this.writeToFile(service, 'error', message);
                }

                this.watchedService.set(service, { listening: false, onServiceLog, onServiceNotice, onServiceWarn, onServiceError })
            }

            if (this.status === 'started' || this.status === 'starting') {
                serviceInfos = this.watchedService.get(service);

                if (serviceInfos) {
                    //console.log(`Démarrage de l'écoute des logs pour le service ${service.constructor.name}...`)

                    service.on('log', serviceInfos.onServiceLog);
                    service.on('notice', serviceInfos.onServiceNotice);
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
            service.off('warn', serviceInfos.onServiceWarn);
            service.off('error', serviceInfos.onServiceError);

            serviceInfos.listening = false;
            this.watchedService.delete(service);
        }
    }


    private displayConsole(service: ServiceAbstract, severity: 'log' | 'notice' | 'warn' | 'error', message: string) {

        const now = function (date?: Date) {
            return (date ?? new Date).toLocaleTimeString();
            return getUsDateTime(date).replace(' ', ' | ');
        }

        if (severity === 'error') {
            console.error(`${now()} | ${service.constructor.name} | ❌ ${message}`);

        } else if (severity === 'warn') {
            console.warn(`${now()} | ${service.constructor.name} | ⚠️ ${message}`);

        } else if (severity === 'notice') {
            console.log(`${now()} | ${service.constructor.name} | ✅ ${message}`);

        } else {
            console.log(`${now()} | ${service.constructor.name} | ${message}`);
        }
    }


    private writeToFile(service: ServiceAbstract, severity: 'log' | 'notice' | 'warn' | 'error', message: string) {
        let logFile = '';
        let text = '';

        const now = getUsDateTime;

        if (severity === 'error') {
            logFile = `${logDir}/pumpmonitor.error`;
            text = `${now()} | ${service.constructor.name} | ❌ ${message}`;

        } else if (severity === 'warn') {
            logFile = `${logDir}/pumpmonitor.warn`;
            text = `${now()} | ${service.constructor.name} | ⚠️ ${message}`;

        } else if (severity === 'notice') {
            logFile = `${logDir}/pumpmonitor.log`;
            text = `${now()} | ${service.constructor.name} | ✅ ${message}`;

        } else {
            logFile = `${logDir}/pumpmonitor.log`;
            text = `${now()} | ${service.constructor.name} | ${message}`;
        }

        if (logDir && logFile && text) {
            fs.appendFileSync(logFile, text + '\n');
        }
    }

}


