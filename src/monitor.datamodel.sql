

CREATE DATABASE if not exists `pumpfun_indexer` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;

CREATE USER if not exists 'pumpfun'@'localhost' IDENTIFIED BY 'pumpfun';
-- GRANT ALL PRIVILEGES ON *.* TO 'pumpfun'@'localhost';
GRANT ALL PRIVILEGES ON pumpfun_indexer.* TO 'pumpfun'@'localhost';





drop table if exists tokens;

CREATE TABLE tokens (
    mint VARCHAR(44) NOT NULL,
    txType ENUM('create') NOT NULL,
    traderPublicKey VARCHAR(44) NOT NULL,
    bondingCurveKey VARCHAR(44) NOT NULL,
    vTokensInBondingCurve DECIMAL(24, 9) NOT NULL,
    vSolInBondingCurve DECIMAL(24, 9) NOT NULL,
    price DECIMAL(24, 10) NOT NULL,
    marketCapSol DECIMAL(24, 9) NOT NULL,
    totalSupply DECIMAL(24, 9) NOT NULL,
    name VARCHAR(128) NOT NULL,
    symbol VARCHAR(32) NOT NULL,
    image varchar(512),
    uri varchar(512),
    website VARCHAR(255),
    twitter VARCHAR(255),
    telegram VARCHAR(255),
    dataSource VARCHAR(32) NULL,
    signature VARCHAR(88),
    instructionIdx int(11),
    createdAt TIMESTAMP NULL,
    PRIMARY KEY(mint)
);



drop table if exists trades;

CREATE TABLE trades (
    txType ENUM('buy', 'sell') NOT NULL,
    mint VARCHAR(44) NOT NULL,
    traderPublicKey VARCHAR(44) NOT NULL,
    tokenAmount DECIMAL(24, 9) NOT NULL,
    solAmount DECIMAL(24, 9) NOT NULL,
    tokenPostBalance DECIMAL(24, 9),
    bondingCurveKey VARCHAR(44) NOT NULL,
    vTokensInBondingCurve DECIMAL(24, 9) NOT NULL,
    vSolInBondingCurve DECIMAL(24, 9) NOT NULL,
    price DECIMAL(24, 10) NOT NULL,
    marketCapSol DECIMAL(24, 9) NOT NULL,
    dataSource VARCHAR(50) NOT NULL,
    signature VARCHAR(88),
    instructionIdx int(11),
    timestamp TIMESTAMP NULL,
    INDEX idx_mint (mint),
    INDEX idx_trader (traderPublicKey),
    PRIMARY KEY (signature, instructionIdx)
);



/*

select count(*) as nb from tokens;

select mint, name, symbol, price, marketCapSol from tokens order by createdAt desc limit 15;

select * from tokens order by createdAt desc limit 1 \G

select mint, name, symbol, tok.price, tok.marketCapSol, count(tr.signature) as trades, createdAt, timestamp as updatedAt
from tokens tok
left join trades tr using (mint)
group by mint
order by tr.timestamp desc, createdAt desc
limit 30;

select mint, name, symbol, tok.price, tok.marketCapSol, count(tr.signature) as trades, createdAt, timestamp as updatedAt
from tokens tok
left join trades tr using (mint)
where mint = 'EtvH36cn1ACvxzcnoVz273WZ1oiH2jPGHZxjtatnpump'
group by mint
order by tr.timestamp desc, createdAt desc;



select count(*) as nb from trades;

select * from trades order by timestamp desc limit 1 \G

select mint, timestamp, txType, solAmount, tokenAmount, round(solAmount / tokenAmount, 10) as price, marketCapSol from trades order by timestamp desc limit 15;

select mint, timestamp, txType, solAmount, tokenAmount, round(solAmount / tokenAmount, 10) as price, marketCapSol from trades where mint = 'EtvH36cn1ACvxzcnoVz273WZ1oiH2jPGHZxjtatnpump' order by timestamp;


*/