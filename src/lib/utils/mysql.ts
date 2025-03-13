// mysql.ts

import mysql, { FieldInfo, MysqlError, OkPacket } from 'mysql';
import { RowDataPacket } from 'mysql2';
import { sleep } from './time.util';


class MySQLClient {
    private db: mysql.Connection;
    private locked = false;

    constructor(config: {
        host: string;
        user: string;
        password: string;
        database: string;
        port?: number;
    }) {
        const { host, user, password, database, port } = config;
        const dsn = `mysql://${user}:${password}@${host}:${port || 3306}/${database}?charset=utf8mb4_general_ci`;
        console.log('sql connecting...')
        this.db = mysql.createConnection(dsn);
        console.log('sql connected')
    }


    async lock() {
        while (this.locked) {
            //console.log('locked');
            await sleep(10);
        }
        //console.log('passed');

        this.locked = true;
    }


    unlock() {
        this.locked = false;
    }


    async execute(sql: string, params?: any[]): Promise<OkPacket> {

        const sqlClient = this;
        await sqlClient.lock();

        return new Promise((resolve, reject) => {
            this.db.query(sql, params, (err: MysqlError | null, results?: any, fields?: FieldInfo[]) => {
                if (err) {
                    console.error(`[ERROR] [MysqlDb] sqlExec error: ${err.message}`);
                    console.debug(`SQL: ${sql}`);
                    sqlClient.unlock();
                    reject(err);
                    return;
                }

                sqlClient.unlock();
                resolve(results);
            });
        });
    }


    async query<T = RowDataPacket[]>(sql: string, params?: any[]): Promise<T> {
        return new Promise((resolve, reject) => {
            this.db.query(sql, params, (err: MysqlError | null, results?: any, fields?: FieldInfo[]) => {
                if (err) {
                    console.error(`[ERROR] [MysqlDb] sqlExec error: ${err.message}`);
                    console.debug(`SQL: ${sql}`);
                    return reject(err);
                }

                resolve(results);
            });
        });
    }


    async insert<T extends object>(tableName: string, data: T): Promise<number> {
        // Préparer les champs et les valeurs
        const fields = Object.keys(data);
        const placeholders = fields.map(() => '?').join(', ');
        const values = Object.values(data);

        const sql = `INSERT INTO ${tableName} (${fields.join(', ')}) VALUES (${placeholders})`;

        //console.log('insert:', sql, values);

        const result = await this.execute(sql, values);
        return result.insertId;
    }


    async insertMultiple<T extends object>(tableName: string, rows: T[]): Promise<mysql.OkPacket | null> {
        if (rows.length === 0) {
            return null;
        }

        // Préparer les champs et les valeurs
        const fields = Object.keys(rows[0]);

        // Créer les placeholders pour chaque ligne
        const rowPlaceholders = rows.map(() =>
            `(${fields.map(() => '?').join(', ')})`
        ).join(', ');

        // Aplatir toutes les valeurs en un seul tableau
        const values = rows.flatMap(row =>
            fields.map(field => (row as any)[field])
        );

        const sql = `INSERT INTO ${tableName} (${fields.join(', ')}) VALUES ${rowPlaceholders}`;

        const result = await this.execute(sql, values);

        return result;
    }


    async update<T extends object>(tableName: string, data: T, whereClause: string, whereParams: any[] = []): Promise<number> {
        // Préparer les SET parts
        const setParts = Object.keys(data).map(key => `${key} = ?`);
        const values = Object.values(data);

        const sql = `UPDATE ${tableName} SET ${setParts.join(', ')} WHERE ${whereClause}`;

        // Combiner les valeurs de data et les paramètres de where
        const allParams = [...values, ...whereParams];

        //console.log('update:', sql, allParams);

        const result = await this.execute(sql, allParams);
        return result.affectedRows;
    }


    async delete(tableName: string, whereClause: string, whereParams: any[] = []): Promise<number> {
        const sql = `DELETE FROM ${tableName} WHERE ${whereClause}`;

        const result = await this.execute(sql, whereParams);
        return result.affectedRows;
    }


    async close(): Promise<void> {
        this.db.end();
    }
}


export default MySQLClient;


