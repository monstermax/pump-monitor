// Database.service.ts

import { MongoClient, Db, WithId, Document } from 'mongodb';

import { appConfig } from "../../env";
import { selectItems, SelectItemsOptions } from "../../lib/utils/model.util";
import { PortfolioHolding } from "../models/Portfolio.model";
import { Token } from "../models/Token.model";
import { TokenAnalysis } from "../models/TokenAnalysis.model";
import { ServiceAbstract } from "./abstract.service";


export type InMemoryData = {
    tokens: Map<string, Token>;
    tokensAnalysis: Map<string, TokenAnalysis>;
    tokensHoldings: Map<string, PortfolioHolding>;
};


export class Database extends ServiceAbstract {
    private inMemoryData: InMemoryData = {
        tokens: new Map(),
        tokensAnalysis: new Map(),
        tokensHoldings: new Map(),
    };

    private mongoClient: MongoClient | null = null;
    private mongoDb: Db | null = null;


    // Méthodes de gestion du service

    async start() {
        if (this.status !== 'stopped') return;
        super.start();

        await this.setupMongoDBIndexes();

        // Charger les données depuis MongoDB
        try {
            await this.loadFromMongoDB();
            this.log("Données chargées depuis MongoDB");

        } catch (error) {
            this.error(`Erreur lors du chargement depuis MongoDB: ${error}`);
        }

        super.started();
    }


    async stop() {
        if (this.status !== 'started') return;
        super.stop();

        if (this.mongoClient) {
            await this.mongoClient.close();
        }

        super.stopped();
    }



    private async setupMongoDBIndexes(): Promise<void> {
        if (!this.mongoDb) return;

        const tokensCollection = this.mongoDb.collection<Token>('tokens');
        const tokensAnalysisCollection = this.mongoDb.collection<TokenAnalysis>('tokens_analysis');
        const tokensHoldingsCollection = this.mongoDb.collection<PortfolioHolding>('tokens_holdings');

        try {
            // Créer un index unique sur l'adresse du token
            await tokensCollection.createIndex({ address: 1 }, { unique: true });
            await tokensCollection.createIndex({ createdAt: 1 });
            await tokensCollection.createIndex({ lastUpdated: 1 });

            // Créer un index unique sur l'adresse du token
            await tokensAnalysisCollection.createIndex({ tokenAddress: 1 }, { unique: true });
            await tokensAnalysisCollection.createIndex({ updated: 1 });

            // Créer un index unique sur l'adresse du token
            await tokensHoldingsCollection.createIndex({ tokenAddress: 1 }, { unique: true });
            await tokensAnalysisCollection.createIndex({ lastUpdated: 1 });

            console.log("MongoDB indexes created successfully");

        } catch (err: any) {
            console.error("Error creating MongoDB indexes:", err);
        }
    }



    // Méthodes pour la gestion des tokens

    addToken(token: Token) {
        if (this.inMemoryData.tokens.has(token.address)) {
            this.warn(`Token ${token.address} déjà existant`);
            return false;
        }

        this.inMemoryData.tokens.set(token.address, token);
        this.emit('token_added', token);

        /* await */ this.saveTokenToMongo(token);

        return true;
    }


    setToken(token: Token) {
        if (! this.inMemoryData.tokens.has(token.address)) {
            this.warn(`Token ${token.address} non trouvé pour la mise à jour`);
            return false;
        }

        this.inMemoryData.tokens.set(token.address, token);
        this.emit('token_updated', token);

        /* await */ this.saveTokenToMongo(token);

        return true;
    }


    updateToken(tokenAddress: string, tokenUpdate?: Partial<Token>) {
        const token: Token | undefined = this.inMemoryData.tokens.get(tokenAddress);

        if (! token) {
            this.warn(`Token ${tokenAddress} non trouvé pour la mise à jour`);
            return false;
        }

        if (tokenUpdate && Object.keys(tokenUpdate).length > 0) {
            Object.assign(token, tokenUpdate);
            this.emit('token_updated', token);
        }

        /* await */ this.saveTokenToMongo(token);

        return true;
    }


    getTokenByAddress(address: string) {
        return this.inMemoryData.tokens.get(address) || null;
    }


    getTokensCount() {
        return this.inMemoryData.tokens.size;
    }


    selectTokens(selectOptions: SelectItemsOptions<Token> = {}): Token[] {
        const tokensTmp: Token[] = Array.from(this.inMemoryData.tokens.values());
        return selectItems(tokensTmp, selectOptions);
    }



    // Méthodes pour la gestion des holdings de tokens

    addTokenHolding(holding: PortfolioHolding) {
        if (this.inMemoryData.tokensHoldings.has(holding.tokenAddress)) {
            this.warn(`Holding du token ${holding.tokenAddress} déjà existante`);
            return false;
        }

        this.inMemoryData.tokensHoldings.set(holding.tokenAddress, holding);
        this.emit('token_holdings_updated', holding);

        /* await */ this.saveTokenHoldingsToMongo(holding);

        return true;
    }


    setTokenHolding(holding: PortfolioHolding) {
        if (! this.inMemoryData.tokensHoldings.has(holding.tokenAddress)) {
            this.warn(`Holding du Token ${holding.tokenAddress} non trouvée pour la mise à jour`);
            return false;
        }

        this.inMemoryData.tokensHoldings.set(holding.tokenAddress, holding);
        this.emit('token_holdings_updated', holding);

        /* await */ this.saveTokenHoldingsToMongo(holding);

        return true;
    }


    updateTokenHolding(tokenAddress: string, holdingUpdate?: Partial<PortfolioHolding>) {
        const holding: PortfolioHolding | undefined = this.inMemoryData.tokensHoldings.get(tokenAddress);

        if (! holding) {
            this.warn(`Holding du Token ${tokenAddress} non trouvée pour la mise à jour`);
            return false;
        }

        if (holdingUpdate && Object.keys(holdingUpdate).length > 0) {
            Object.assign(holding, holdingUpdate);
            this.emit('token_holdings_updated', holding);
        }

        /* await */ this.saveTokenHoldingsToMongo(holding);

        return true;
    }


    deleteTokenHolding(tokenAddress: string) {
        if (! this.inMemoryData.tokensHoldings.has(tokenAddress)) {
            this.warn(`Holding du token non trouvée pour suppression`);
            return false;
        }

        this.inMemoryData.tokensHoldings.delete(tokenAddress);
        this.emit('token_holdings_updated', null, tokenAddress);

        return true;
    }


    closeTokenHoldingPosition(tokenAddress: string) {
        if (! this.inMemoryData.tokensHoldings.has(tokenAddress)) {
            this.warn(`Holding du token non trouvée pour suppression`);
            return false;
        }


        this.updateTokenHolding(tokenAddress, { closed: true });

        //this.inMemoryData.tokensHoldings.delete(tokenAddress);
        //this.emit('token_holdings_updated', null, tokenAddress);

        return true;
    }


    getTokenHolding(address: string) {
        return this.inMemoryData.tokensHoldings.get(address) || null;
    }


    /** Récupérer tous les holdings */
    getAllHoldings(): PortfolioHolding[] {
        return Array.from(this.inMemoryData.tokensHoldings.values());
    }


    /** Rechercher/Filtrer/Trier les holdings */
    selectHoldings(selectOptions: SelectItemsOptions<PortfolioHolding> = {}): PortfolioHolding[] {
        const holdingsTmp: PortfolioHolding[] = Array.from(this.inMemoryData.tokensHoldings.values());
        return selectItems(holdingsTmp, selectOptions);
    }



    // Méthodes pour la gestion des analyses de tokens

    addTokenAnalysis(analysis: TokenAnalysis) {
        if (this.inMemoryData.tokensAnalysis.has(analysis.tokenAddress)) {
            this.warn(`Analyse du token ${analysis.tokenAddress} déjà existante`);
            return false;
        }

        this.inMemoryData.tokensAnalysis.set(analysis.tokenAddress, analysis);
        this.emit('token_analysis_updated', analysis);

        /* await */ this.saveTokenAnalysisToMongo(analysis);

        return true;
    }


    setTokenAnalysis(analysis: TokenAnalysis) {
        if (! this.inMemoryData.tokensAnalysis.has(analysis.tokenAddress)) {
            this.warn(`Analyse du Token ${analysis.tokenAddress} non trouvée pour la mise à jour`);
            return false;
        }

        this.inMemoryData.tokensAnalysis.set(analysis.tokenAddress, analysis);
        this.emit('token_analysis_updated', analysis);

        /* await */ this.saveTokenAnalysisToMongo(analysis);

        return true;
    }


    updateTokenAnalysis(tokenAddress: string, analysisUpdate?: Partial<Token>) {
        const analysis: TokenAnalysis | undefined = this.inMemoryData.tokensAnalysis.get(tokenAddress);

        if (! analysis) {
            this.warn(`Analyse du Token ${tokenAddress} non trouvée pour la mise à jour`);
            return false;
        }

        if (analysisUpdate && Object.keys(analysisUpdate).length > 0) {
            Object.assign(analysis, analysisUpdate);
            this.emit('token_analysis_updated', analysis);
        }

        /* await */ this.saveTokenAnalysisToMongo(analysis);

        return true;
    }


    getTokenAnalysis(address: string) {
        return this.inMemoryData.tokensAnalysis.get(address) || null;
    }




    // Méthodes pour la synchronisation avec MongoDB

    async connectToMongo() {
        if (!this.mongoClient) {
            this.mongoClient = new MongoClient(appConfig.mongodb.uri, {
                connectTimeoutMS: 30000,
                socketTimeoutMS: 45000,
                serverSelectionTimeoutMS: 30000,
                maxIdleTimeMS: 120000,
                waitQueueTimeoutMS: 30000,
                heartbeatFrequencyMS: 10000,
                retryWrites: true,
                retryReads: true,
            });

            await this.mongoClient.connect();
            this.mongoDb = this.mongoClient.db(appConfig.mongodb.dbName);
        }
    }


    async loadFromMongoDB() {
        await this.connectToMongo();
        if (!this.mongoDb) return;

        // Charger les tokens
        const tokensCollection = this.mongoDb.collection<Token>('tokens');
        const tokensDocs = await tokensCollection.find({}).toArray();

        tokensDocs.forEach(tokenDoc => {
            const token: Token = convertFromMongo(tokenDoc);
            this.inMemoryData.tokens.set(token.address, token);
        });



        // charges les analyses
        const tokensAnalysisCollection = this.mongoDb.collection<TokenAnalysis>('tokens_analysis');
        const tokensAnalysisDocs = await tokensAnalysisCollection.find({}).toArray();

        tokensAnalysisDocs.forEach(analysisDoc => {
            const analysis: TokenAnalysis = convertFromMongo(analysisDoc);
            this.inMemoryData.tokensAnalysis.set(analysis.tokenAddress, analysis);
        });


        // charges les holdings
        //const tokensHoldingsCollection = this.mongoDb.collection<PortfolioHolding>('tokens_holdings');
        //const tokensHoldingsDocs = await tokensHoldingsCollection.find({}).toArray();

        //tokensHoldingsDocs.forEach(holdingDoc => {
        //    const holding: PortfolioHolding = convertFromMongo(holdingDoc);
        //    if (holding.amount > 0.000_001) {
        //        this.inMemoryData.tokensHoldings.set(holding.tokenAddress, holding);
        //    }
        //});
    }


    async saveTokenToMongo(token: Token) {
        await this.connectToMongo();
        if (!this.mongoDb) return;

        const tokensCollection = this.mongoDb.collection<Token>('tokens');
        await tokensCollection.updateOne({ tokenAddress: token.address }, { $set: token }, { upsert: true });
    }


    async saveTokenAnalysisToMongo(analysis: TokenAnalysis) {
        await this.connectToMongo();
        if (!this.mongoDb) return;

        const tokensAnalysisCollection = this.mongoDb.collection<TokenAnalysis>('tokens_analysis');
        await tokensAnalysisCollection.updateOne({ tokenAddress: analysis.tokenAddress }, { $set: analysis }, { upsert: true });
    }

    async saveTokenHoldingsToMongo(holding: PortfolioHolding) {
        await this.connectToMongo();
        if (!this.mongoDb) return;

        const tokensHoldingsCollection = this.mongoDb.collection<PortfolioHolding>('tokens_holdings');
        await tokensHoldingsCollection.updateOne({ tokenAddress: holding.tokenAddress }, { $set: holding }, { upsert: true });
    }


    async clearMongoDatabase() {
        await this.connectToMongo();
        if (!this.mongoDb) return;

        if (0) {
            const tokensHoldingsCollection = this.mongoDb.collection<PortfolioHolding>('tokens_holdings');
            const tokensHoldingsDocs = await tokensHoldingsCollection.find({}).toArray();

            const holdingsAddresses = tokensHoldingsDocs.filter(holding => holding.amount > 0).map(holding => holding.tokenAddress);

            await this.mongoDb.collection('tokens').deleteMany({ address: { $nin: holdingsAddresses } });
            await this.mongoDb.collection('tokens_analysis').deleteMany({ tokenAddress: { $nin: holdingsAddresses } });

        } else {
            await this.mongoDb.collection('tokens').deleteMany({});
            await this.mongoDb.collection('tokens_analysis').deleteMany({});
            //await this.mongoDb.collection('tokens_holdings').deleteMany({});

        }

        this.log('Database cleared');
    }
}




function convertFromMongo<T>(doc: WithId<T>): T {
    // Créer une copie pour ne pas modifier l'original
    const result: Document & { _id?: any } = { ...doc };

    // Supprimer le champ _id qui est spécifique à MongoDB
    delete result._id;

    // Convertir les dates stockées en string (ISO format) en objets Date
    const convertDates = (obj: any) => {
        for (const key in obj) {
            const value = obj[key];

            // Vérifier si c'est une date en format ISO string
            if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
                obj[key] = new Date(value);

            } else if (value && typeof value === 'object' && !Array.isArray(value)) {
                // Traiter récursivement les objets imbriqués
                convertDates(value);

            } else if (Array.isArray(value)) {
                // Traiter récursivement les tableaux
                value.forEach(item => {
                    if (item && typeof item === 'object') {
                        convertDates(item);
                    }
                });
            }
        }
        return obj;
    };

    return convertDates(result) as T;
}

