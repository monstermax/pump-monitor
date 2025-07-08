
# Pump.fun snipe monitor


inspiration:
- https://github.com/LimaTechnologies/pumpdotfun-fast-listener
- https://github.com/Takhi77/Solana-pumpfun-sniper/blob/master/bot.ts
- https://github.com/cryptoscan-pro/pumpfun-sdk
- https://github.com/whistledev411/pumpfun-sniper/blob/master/src/pumputils/utils/buyToken.ts
- https://github.com/1fge/pump-fun-sniper-bot/blob/main/bonding-curve.go
- https://github.com/elizaOS/eliza/blob/main/packages/plugin-solana/src/actions/pumpfun.ts
- https://github.com/rckprtr/pumpdotfun-sdk/blob/main/src/pumpfun.ts
- https://github.com/TreeCityWes/Pump-Fun-Trading-Bot-Solana/blob/main/script.mjs
- https://github.com/dwlee91/solana-pumpfun-sniper-bot/blob/main/sniper.mjs
- https://github.com/Shyft-to/solana-defi/blob/main/PumpFun/Typescript/stream-pump-fun-transactions-and-detect-buy-sell-events/index.ts
- https://github.com/travis-rx/pump.fun_volume_bot
- https://github.com/Shyft-to/solana-defi/blob/main/PumpFun/Typescript/stream-pump-fun-transactions-and-detect-buy-sell-events/index.ts



- https://pumpportal.fun/data-api/real-time

- https://github.com/thetateman/Pump-Fun-API

- https://medium.com/@pumpportal/building-a-trading-bot-with-a-pump-fun-api-52ba6b3d66d1

- https://blogs.shyft.to/how-to-track-token-transfers-from-pump-fun-to-raydium-5ada83c2ac58
- https://github.com/Shyft-to/solana-defi/blob/main/PumpFun/Typescript/%5BGRPC%5DPumpfun_migration/index.ts

- https://docs.bitquery.io/docs/category/solana/
- https://docs.bitquery.io/docs/examples/Solana/Pump-Fun-API/
- https://ide.bitquery.io/Pumpfun-DEX-Trades_1

- https://frontend-api-v3.pump.fun/api
- https://frontend-api-v3.pump.fun/trades/latest
- https://frontend-api-v3.pump.fun/coins/latest
- https://frontend-api-v3.pump.fun/coins/nHqLPndJTu4gvrcSFoD1bRrwTnQRB9moruhw1U2pump
- https://frontend-api-v3.pump.fun/candlesticks/nHqLPndJTu4gvrcSFoD1bRrwTnQRB9moruhw1U2pump

- https://advanced-api-v2.pump.fun/api
- https://advanced-api-v2.pump.fun/coins/list [sortBy, marketCapFrom, marketCapTo, volumeFrom, volumeTo, numHoldersFrom, numHoldersTo]
- https://advanced-api-v2.pump.fun/coins/featured
- https://advanced-api-v2.pump.fun/coins/about-to-graduate
- https://advanced-api-v2.pump.fun/coins/metadata-and-trades/AhMyrvkpMPzYhv6XvkSa8yvBwkxZfF7aUtmvY8tipump

- https://j4nt4ncrypto.medium.com/pumpfun-api-expands-new-endpoints-for-enhanced-solana-trading-4ccba5c902e9
- https://www.pumpfunapi.click/

- https://github.com/TreeCityWes/Pump-Fun-Trading-Bot-Solana

- https://github.com/whistledev411?tab=repositories
- https://github.com/whistledev411/pumpfun-sniper

- https://github.com/Fn0skig/api.pump.fun

- pump snipe : https://github.com/whistledev411/pumpfun-sniper/blob/master/src/index.ts





# PumpMonitor

## MANAGERS
 - ConnectionManager    : Connexion aux RPC Solana
 - TokenRepository      : Repository de tokens
 - TokenAnalysisManager : Analyseur de tokens
 - TransactionManager   : Gère les transactions Solana

## SERVICES
 - WebAppService        : Gestion de la webapp (express + socket.io)
 - PortfolioService     : Gestion du wallet et des tokens holdés
 - PumpListenerService  : Recoit les evenements create/buy/sell
 - TradingService       : Gère les achats/ventes de tokens
 - PriceFeedService     : Récupère le prix du SOL en dollars
 - SystemMonitorService : Surveille les ressources systemes

## ANALYZERS
- BuyOpportunityAnalyzer   : Analyseur spécialisé dans la détection d'opportunités d'achat
- SellConditionAnalyzer    : Analyseur spécialisé dans la détection de conditions de vente
   - TrendUpdater          : Calcule les tendances sur différentes fenêtres temporelles
   - GrowthAnalyzer        : Analyseur spécialisé dans l'évaluation de la croissance et des jalons des tokens (prix, marketcap, holders, trades, ...).
   - RiskAndSafetyAnalyzer : Analyse de risque, qualité et sécurité (détection de rug pull, vente du dev, vente de whale, ventes massives, ...)
   - TradingSignalAnalyzer : Analyseur spécialisé dans la génération de signaux de trading, basés sur la combinaison des différentes analyses de token
- TraderAnalyzer           : Analyseur spécialisé dans la surveillance de traders efficients




# PROMPT

## PROJET PUMP.FUN MONITOR

OBJECTIF :
Bot pour monitorer les tokens sur pump.fun avec focus sur :
- Détection des rug pulls
- Analyse de la croissance des tokens
- Signaux de trading

ARCHITECTURE :
1. Plusieurs sources de données disponibles
- La source privilégiée (car plus rapide) est le WebSocket RPC Solana (provider "SolanaFastListenerClient")
- Autres sources disponibles mais abandonnées (car moins rapides et/ou données non garanties) : Websocket de l'API Pump.fun, Websocket public utilisé sur le site frontend pump.fun
- Receptions des transactions décodées : TokenCreation, Trade
- Émission des events vers PumpMonitor

2. Services
- PumpMonitor : Service principal orchestrant les analystes
- TokenAnalyzer : Analyse des tokens (milestones, croissance)
- RugPullAnalyzer : Détection des patterns de rug pull (dépendance de TokenAnalyzer)
- SafetyAnalyzer : Détection des patterns de qualité (dépendance de TokenAnalyzer)
- TraderAnalyzer : Analyze les performances des traders suivis (fonctionnalité non prioritaire)
- PriceFeed : Prix SOL/USD via Raydium API
- SocketIO : Transmission d'information à l'app web React
- Webserver : Service Express gérant le endpoint '/api' pour l'app web React

3. Base de données (MongoDB)
- tokens : Suivi des tokens
- trades : Historique des trades
- traders : Suivi des traders (trades et performance)
- token_analytics : Analyses performances, risque et milestones (10k, 30k, 50k, 75k, 100k USD)
- token_trends : Détection de tendances sur plusieurs fenêtres de temps

INDICATEURS ACTUELS :
1. Milestones
- Temps pour atteindre chaque cap
- Vitesse de croissance entre milestones

2. Rug Pull Detection
- Croissance initiale anormale (< 1s pour 10k)
- Pattern de ventes (ratio, volume)
- Distribution des trades
- Comportement des top traders

PROCHAINS DÉVELOPPEMENTS PRÉVUS :
1. Refactorisation des services d'analyse (TokenAnalyzer, RugPullAnalyzer, SafetyAnalyzer et BuyOpportunityAnalyzer ont des responsabilités qui s’entremêlent. Redondance dans certaines analyses. Dépendances complexes entre les analyzers ) => Refactoriser TokenAnalyzer pour qu’il devienne le service unique d’analyse de tokens :
   1. GrowthAnalyzer (analyse milestones et croissance)
   2. RiskAnalyzer (détection des rug pulls et sécurité)
   3. OpportunityAnalyzer (détection d’opportunités d’achat)
   4. TraderAnalyzer (analyse de performances de traders)
2. Simplifier PumpMonitor pour ne conserver que HandleNewToken et HandleTrade (tout le reste doit aller dans des sous-services)
3. Refactorisation des evenements envoyés à Socket.io
4. Développement interface d'analyse Live sur la web app React
5. Détection d'opportunités d'achat
6. Affinage des critères et seuils d'analyse
7. Amélioration des signaux de trading

Points clés :
- Projet en TypeScript/Node.js
- Focus sur la détection précoce des rug pulls
- Analyse en temps réel des patterns de trading
- Aide à la décision d'achat/vente






# TODO


1) Vitesse de croissance initiale

- Temps pour atteindre les milestones
- Un token qui atteint 10k$ très rapidement mais stagne = risque
- Un token qui monte progressivement = plus sain



2) Distribution des holders

- % détenu par dev/bonding curve/traders
- Alerte si le dev détient plus de 70%
- Nombre de holders différents (diversification)


3) Pattern des trades

- Ratio volume d'achat/vente sur plusieurs fenêtres (2min, 5min, 15min)
- Détection des wallets qui font des gros achats suivis de ventes massives
- Fréquence des trades (activité saine vs manipulation)




# Infos Bounding Curves:
- https://medium.com/@buildwithbhavya/the-math-behind-pump-fun-b58fdb30ed77
- https://yos.io/2018/11/10/bonding-curves/



# Decodage Raydium new pool listener
- https://gist.github.com/endrsmar/684c336c3729ec4472b2f337c50c3cdb


# Test token
- YOMAX : 7waa5vwXLFV38GZooXHVLEKE1bp3cVQ57FpuLwDVpump => balance: 3564784.053156 (0.1 SOL)


# Bot inspiration
- https://pies-organization.gitbook.io/photon-trading/photon-on-sol/settings
- https://pies-organization.gitbook.io/photon-trading/photon-on-sol/live-pairs-feed
- https://pies-organization.gitbook.io/photon-trading/photon-on-sol/trending-page
- https://pies-organization.gitbook.io/photon-trading/photon-on-sol/my-holdings




# Accounts
1. global - L'adresse du compte global PumpFun (PDA)
2. feeRecipient - L'adresse qui reçoit les frais
3. mint - L'adresse du token
4. bondingCurve - L'adresse PDA de la bonding curve
5. associatedBondingCurve - L'adresse du compte ATA lié à la bonding curve
6. associatedUser - L'adresse du compte ATA de l'utilisateur
7. user - L'adresse de l'utilisateur (signataire)
8. SystemProgram - L'adresse du programme système Solana
9. TokenProgram - L'adresse du programme TOKEN (standard SPL)
10. Rent - L'adresse du compte de loyer Solana


# API Pump Fun FRONTEND
- https://frontend-api-v3.pump.fun/candlesticks/Dh8NEe1nQEdgr9shtJ4eNTJffp8ReqrfgWuLQ3pppump
- https://frontend-api-v3.pump.fun/trades/latest


# ABI (pumpfun & raydium)
- https://github.com/chainstacklabs/pump-fun-bot/tree/main/idl
- https://github.com/Shyft-to/solana-defi/blob/main/PumpFun/Typescript/stream-pump-fun-transactions-and-detect-buy-sell-events/idls/pump_0.1.0.json



# wallet/bot à copy trade :
- https://solscan.io/account/GZVSEAajExLJEvACHHQcujBw7nJq98GWUEZtood9LM9b#balanceChanges




# Bots
- phantom
- photon
- bullx
- maestro
- moonshot
- mevx
- bonkbot
- gmgn
- trojan


# Market Maker Bot
- https://smithii.io/en/pump-fun-volume-bot/
  - https://tools.smithii.io/market-maker/solana

# Bundler Bot
- https://smithii.io/en/pump-fun-bundler-bot/
  - https://tools.smithii.io/pump-bundler/solana
  - https://tools.smithii.io/pump-bundle-sell/solana
 

- https://www.easysol.app/ + https://github.com/easysol-app


# Pumpfun testnet
- https://solscan.io/account/6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P?cluster=devnet
- https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_PROGRAM_README.md
- https://github.com/nhuxhr/pumpfun-rs



########################



## 🎨 **Maquette visuelle (wireframe) – Dashboard d'analyse Pump.fun**

### 🖥️ **Vue principale : Dashboard**
 
**Header (en haut) :**  
- Logo (PumpScan ou autre nom)
- Barre de recherche (chercher par token, mint address, owner...)
- Filtres rapides (date, top acheteurs, top vendeurs)
- Boutons : 🔄 Actualiser | ⚙️ Paramètres

---

**Section 1 : Vue d’ensemble globale (cards avec KPIs)**  
- 🔥 **Tokens Mintés** (sur la période)
- 💰 **Volume d’achat** (total en SOL)
- 📈 **Tokens les + achetés** (en résumé)
- 📉 **Tokens les + vendus**
- 📊 **% tokens dead** (pas tradés depuis 24h)

---

**Section 2 : Graphiques & Analytics**  
(avec dropdown pour filtrer par jour/semaine/mois)

- **Graphique 1 : Volume de mint par heure/jour**
- **Graphique 2 : Volume d’achat vs vente**
- **Graphique 3 : Nombre de tokens "rugbés" (graph chute brutale)**

---

**Section 3 : Table des tokens**  
Tableau filtrable et triable avec colonnes comme :
- Nom du token / Mint
- Creator wallet
- Date de mint
- Nombre de holders
- Total buy/sell
- Dernière transaction
- Bouton "voir détails"

---

### 📄 **Vue détaillée : Token individuel**

Quand on clique sur un token dans la table, on arrive sur une page dédiée :

- Logo + nom + mint address
- Graphique prix vs temps
- Graphique volume vs temps
- Timeline des événements (mint, achats, ventes, rug ?)
- Liste des principaux acheteurs / vendeurs
- Détail de la liquidité

---

### 📱 **Responsive mobile :**
- Menu en bas : Home | Tokens | Recherche | Paramètres
- KPI en mode cartes scrollables
- Graphiques empilés en vertical

---

### 🎛️ **Autres idées de fonctionnalités**
- Export CSV/JSON
- Notification si un token explose en volume
- Suivi d’un wallet ou d’un token favori
- Dark mode

---



