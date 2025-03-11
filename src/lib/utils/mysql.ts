
import mysql, { Pool, PoolConnection, RowDataPacket, OkPacket } from 'mysql2/promise';


class MySQLClient {
  private pool: Pool;

  constructor(config: {
    host: string;
    user: string;
    password: string;
    database: string;
    port?: number;
    connectionLimit?: number;
  }) {
    this.pool = mysql.createPool({
      host: config.host,
      user: config.user,
      password: config.password,
      database: config.database,
      port: config.port || 3306,
      connectionLimit: config.connectionLimit || 10,
      waitForConnections: true,
    });
  }

  async getConnection(): Promise<PoolConnection> {
    return await this.pool.getConnection();
  }

  async query<T = RowDataPacket[]>(sql: string, params?: any[]): Promise<T> {
    const [rows] = await this.pool.query(sql, params);
    return rows as T;
  }

  async insert<T extends object>(tableName: string, data: T): Promise<number> {
    // Préparer les champs et les valeurs
    const fields = Object.keys(data);
    const placeholders = fields.map(() => '?').join(', ');
    const values = Object.values(data);

    const sql = `INSERT INTO ${tableName} (${fields.join(', ')}) VALUES (${placeholders})`;

    const [result] = await this.pool.query(sql, values);
    return (result as OkPacket).insertId;
  }

  async update<T extends object>(tableName: string, data: T, whereClause: string, whereParams: any[] = []): Promise<number> {
    // Préparer les SET parts
    const setParts = Object.keys(data).map(key => `${key} = ?`);
    const values = Object.values(data);

    const sql = `UPDATE ${tableName} SET ${setParts.join(', ')} WHERE ${whereClause}`;

    // Combiner les valeurs de data et les paramètres de where
    const allParams = [...values, ...whereParams];

    const [result] = await this.pool.query(sql, allParams);
    return (result as OkPacket).affectedRows;
  }

  async delete(tableName: string, whereClause: string, whereParams: any[] = []): Promise<number> {
    const sql = `DELETE FROM ${tableName} WHERE ${whereClause}`;

    const [result] = await this.pool.query(sql, whereParams);
    return (result as OkPacket).affectedRows;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}


export default MySQLClient;


