// pump_monitor.ts

import { PumpWebsocketApi } from "./listeners/PumpWebsocketApi.listener";
import { Service, ServiceManager } from "./managers/Service.manager";
import { TokenManager } from "./services/TokenManager.service";
import { TokenAnalyzer } from "./services/TokenAnalyzer.service";
import { ServiceAbstract } from "./services/abstract.service";
import { Database } from "./services/Database.service";
import { Logger } from "./services/Logger.service";
import { PriceFeed } from "./services/PriceFeed.service";
import { PumpListener } from "./services/PumpListener.service";
import { SystemMonitor } from "./services/SystemMonitor.service";
import { TradingManager } from "./services/Trading.service";
import { WebApp } from "./services/WebApp.service";
import { PortfolioManager } from "./services/Portfolio.service";


/* ######################################################### */


async function main() {

    // Initialiser le gestionnnaire de services
    const serviceManager = new ServiceManager();


    // Charge les services (sans les lancer)
    const logger = new Logger(serviceManager);
    const pumpListener = new PumpListener(serviceManager);
    const db = new Database(serviceManager);

    const services: Service[] = [
        serviceManager.registerService('Logger', logger),
        serviceManager.registerService('PumpListener', pumpListener),
        serviceManager.registerService('PriceFeed', new PriceFeed(serviceManager)),
        serviceManager.registerService('SystemMonitor', new SystemMonitor(serviceManager)),
        serviceManager.registerService('Database', db),
        serviceManager.registerService('PortfolioManager', new PortfolioManager(serviceManager)),
        serviceManager.registerService('TradingManager', new TradingManager(serviceManager)),
        serviceManager.registerService('WebApp', new WebApp(serviceManager)),
        serviceManager.registerService('TokenManager', new TokenManager(serviceManager)),
        serviceManager.registerService('TokenAnalyzer', new TokenAnalyzer(serviceManager)),
    ];

    const dataSources: Service[] = [
        serviceManager.registerService('PumpWebsocketApi', new PumpWebsocketApi(serviceManager)),
    ];


    // Ajoute les services au logger
    logger.watch(services);
    logger.watch(dataSources);
    serviceManager.startServices([logger]);


    // Vide la base de données MongoDB (optionnel)
    //await db.clearMongoDatabase();


    // Démarre les services
    serviceManager.startServices(services);
    serviceManager.startServices(dataSources);


    // Ajout de dataSources au PumpListener
    pumpListener.watch(dataSources);
}



/* ######################################################### */


// Démarrer le programme
main().catch((err: any) => {
    console.error('Erreur fatale:', err);
    process.exit(1);
});

