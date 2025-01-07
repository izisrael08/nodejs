const express = require('express');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();

// URL de conexão do banco de dados fornecida
const DB_URL = process.env.DB_URL || 'mysql://root:BkBxvDqFQgUFIRvHrOdceGaUiHVXCPNB@autorack.proxy.rlwy.net:13224/railway';

// Criação do pool de conexões com a URL de conexão
const pool = mysql.createPool(DB_URL);

// Rota para exibir os resultados
app.get('/results', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.execute(`
      SELECT Titulo, Hora, Premio, Resultado, Grupo, DATE_FORMAT(DataInsercao, '%d/%m/%Y') AS DataInsercao
      FROM ResultadosLoteria
      ORDER BY Hora DESC, DataInsercao DESC
    `);

    const groupedResults = rows.reduce((acc, current) => {
      const key = `${current.Titulo}-${current.Hora}`;
      if (!acc[key]) {
        acc[key] = { Titulo: current.Titulo, Hora: current.Hora, Dia: current.DataInsercao, Resultados: [] };
      }
      acc[key].Resultados.push({ Premio: current.Premio, Resultado: current.Resultado, Grupo: current.Grupo });
      return acc;
    }, {});

    res.json(Object.values(groupedResults));
  } catch (error) {
    res.status(500).json({ message: 'Erro ao recuperar os resultados', error: error.message });
  }
});

// Configuração do servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
