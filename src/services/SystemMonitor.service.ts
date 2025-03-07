// SystemMonitor.service.ts

import os from 'os';
import { ServiceAbstract } from './abstract.service';
import { ServiceManager } from '../managers/Service.manager';

/* ######################################################### */


export type MemoryMetrics = {
    processRss: number;
    processHeapTotal: number;
    processHeapUsed: number;
    processExternal: number;
    systemTotal: number;
    systemFree: number;
    systemUsed: number;
    systemUsagePercent: number;
}


export type CpuMetrics = {
    processUsagePercent: number;
    systemAverageLoad: {
        load1: string;
        load5: string;
        load15: string;
        cpuCount: number;
    };
}


export type SystemLoadAverage = {
    load1: string;
    load5: string;
    load15: string;
    cpuCount: number;
}


export type SystemMetrics = {
    memory: MemoryMetrics,
    cpu: CpuMetrics,
    timestamp: number,
}


/* ######################################################### */


// Variables pour suivre l'utilisation CPU entre les appels
let startTime: [number, number];
let startUsage: NodeJS.CpuUsage;


/* ######################################################### */


export class SystemMonitor extends ServiceAbstract {
    private metrics: SystemMetrics | null = null;


    start(): void {
        if (this.status !== 'stopped') return;
        super.start();

        this.updateMetrics();

        if (! this.intervals.updateMetrics) {
            this.intervals.updateMetrics = setInterval(() => this.updateMetrics(), 10_000);
        }

        super.start();
    }


    getMetrics(): SystemMetrics | null {
        if (!this.metrics) return this.metrics;

        //this.emit('log', `Metrics sent ! Load avg: ${this.metrics.cpu.systemAverageLoad.load1} | Mem: ${this.metrics.memory.systemUsagePercent}%`);
        return this.metrics;
    }


    updateMetrics(): SystemMetrics | null {
        this.metrics = getSystemMetrics();

        //this.emit('log', `Updated metrics. Load avg: ${this.metrics.cpu.systemAverageLoad.load1} | Mem: ${this.metrics.memory.systemUsagePercent}%`);
        this.emit('metrics_updated');

        return this.metrics;
    }
}



/* ######################################################### */



/**
 * Obtient les statistiques d'utilisation CPU et mémoire du processus actuel
 * @returns {Object} Statistiques système
 */
export function getSystemMetrics(): SystemMetrics {
    // Récupération de l'utilisation mémoire
    const memoryUsage = process.memoryUsage();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();

    // Convertir les valeurs de bytes en MB pour plus de lisibilité
    const memoryMetrics: MemoryMetrics = {
        processRss: Math.round(memoryUsage.rss / 1024 / 1024), // Resident Set Size en MB
        processHeapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // Heap total en MB
        processHeapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // Heap utilisé en MB
        processExternal: Math.round(memoryUsage.external / 1024 / 1024), // Mémoire externe en MB
        systemTotal: Math.round(totalMemory / 1024 / 1024), // Mémoire totale du système en MB
        systemFree: Math.round(freeMemory / 1024 / 1024), // Mémoire libre du système en MB
        systemUsed: Math.round((totalMemory - freeMemory) / 1024 / 1024), // Mémoire utilisée du système en MB
        systemUsagePercent: Math.round(((totalMemory - freeMemory) / totalMemory) * 100), // Pourcentage d'utilisation
    };

    // Récupération de l'utilisation CPU (nécessite deux mesures pour calculer le pourcentage)
    const cpuMetrics: CpuMetrics = getCpuUsage();

    return {
        memory: memoryMetrics,
        cpu: cpuMetrics,
        timestamp: Date.now()
    };
}



/**
 * Calcule l'utilisation CPU du processus actuel
 * @returns {Object} Métriques CPU
 */
export function getCpuUsage(): CpuMetrics {
    // Si c'est le premier appel, initialiser les valeurs de départ
    if (!startTime) {
        startTime = process.hrtime();
        startUsage = process.cpuUsage();

        return {
            processUsagePercent: 0,
            systemAverageLoad: getSystemLoadAverage()
        };
    }

    // Obtenir le temps écoulé en microsecondes
    const elapTime = process.hrtime(startTime);
    const elapTimeMS = elapTime[0] * 1000 + elapTime[1] / 1000000;

    // Obtenir l'utilisation CPU en microsecondes
    const elapUsage = process.cpuUsage(startUsage);
    const elapUserMS = elapUsage.user / 1000; // Convertir en millisecondes
    const elapSysMS = elapUsage.system / 1000; // Convertir en millisecondes

    // Calculer le pourcentage d'utilisation CPU (au total sur tous les cœurs)
    const cpuPercent = Math.round(100 * (elapUserMS + elapSysMS) / elapTimeMS);

    // Mettre à jour les valeurs de départ pour le prochain appel
    startTime = process.hrtime();
    startUsage = process.cpuUsage();

    return {
        processUsagePercent: cpuPercent,
        systemAverageLoad: getSystemLoadAverage()
    };
}



/**
 * Obtient la charge moyenne du système (tous processus confondus)
 * @returns {Object} Load average sur 1, 5 et 15 minutes
 */
export function getSystemLoadAverage(): SystemLoadAverage {
    const loadAvg = os.loadavg();

    return {
        load1: loadAvg[0].toFixed(2),
        load5: loadAvg[1].toFixed(2),
        load15: loadAvg[2].toFixed(2),
        cpuCount: os.cpus().length
    };
}


