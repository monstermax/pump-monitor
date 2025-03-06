// Service.manager.ts

import { PumpWebsocketApi } from "../listeners/PumpWebsocketApi.listener";
import { ServiceAbstract } from "../services/abstract.service";
import { Database } from "../services/Database.service";
import { Logger } from "../services/Logger.service";
import { PriceFeed } from "../services/PriceFeed.service";
import { PumpListener } from "../services/PumpListener.service";
import { SystemMonitor } from "../services/SystemMonitor.service";
import { TradingManager } from "../services/Trading.service";
import { WebApp } from "../services/WebApp.service";
import { TokenManager } from "../services/TokenManager.service";
import { TokenAnalyzer } from "../services/TokenAnalyzer.service";
import { PortfolioManager } from "../services/Portfolio.service";


/* ######################################################### */


export type Services = {
    Logger: Logger,
    PriceFeed: PriceFeed,
    SystemMonitor: SystemMonitor,
    PumpListener: PumpListener,
    PumpWebsocketApi: PumpWebsocketApi,
    Database: Database,
    TradingManager: TradingManager,
    WebApp: WebApp,
    TokenManager: TokenManager,
    TokenAnalyzer: TokenAnalyzer,
    PortfolioManager: PortfolioManager,
};

export type ServiceName = keyof Services;
export type Service = Services[ServiceName]


/* ######################################################### */


export class ServiceManager {
    private services: Map<ServiceName, Service> = new Map;


    registerService<T extends ServiceName>(serviceName: T, service: Service): Services[T] {
        if (this.services.has(serviceName)) {
            throw new Error(`Service ${serviceName} déjà enregistré`);
        }

        this.services.set(serviceName, service);

        return service as Services[T];
    }


    getService<T extends ServiceName>(serviceName: T): Services[T] {
        return this.services.get(serviceName) as Services[T];
    }


    startServices(services: Service[]) {
        services.forEach(service => service.start());
    }

}


