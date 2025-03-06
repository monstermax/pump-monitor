// Database.service.ts

import { appConfig } from "../env";
import { selectItems, SelectItemsOptions } from "../lib/utils/model.util";
import { ServiceManager } from "../managers/Service.manager";
import { PortfolioHolding } from "../models/Portfolio.model";
import { Token } from "../models/Token.model";
import { TokenAnalysis } from "../models/TokenAnalysis.model";
import { ServiceAbstract } from "./abstract.service";
import { MongoClient, Db, WithId, Document } from 'mongodb';


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


    updateTokenHolding(tokenAddress: string, holdingUpdate?: Partial<Token>) {
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

        // TODO: delete in MongoDB

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
            this.mongoClient = new MongoClient(appConfig.mongodb.uri);

            await this.mongoClient.connect();
            this.mongoDb = this.mongoClient.db(appConfig.mongodb.dbName);
        }
    }


    async loadFromMongoDB() {
        await this.connectToMongo();
        if (!this.mongoDb) return;

        // Charger les tokens
        const tokensCollection = this.mongoDb.collection<Token>('tokens');
        const tokenDocs = await tokensCollection.find({}).toArray();

        tokenDocs.forEach(tokenDoc => {
            const token: Token = convertFromMongo(tokenDoc);
            this.inMemoryData.tokens.set(token.address, token);
        });

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

        await this.mongoDb.collection('tokens_analysis').deleteMany({});
        await this.mongoDb.collection('tokens').deleteMany({});

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

