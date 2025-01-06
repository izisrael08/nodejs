// Importando as dependências
const express = require('express');
const path = require('path');
const puppeteer = require('puppeteer');
const cors = require('cors');
const mysql = require('mysql2/promise');
require('dotenv').config();

// Criando a instância do Express
const app = express();

// Conexão com o banco de dados usando as variáveis de ambiente
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.PORT || 3306,
  connectionLimit: 10
});


// Middleware para servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Middleware CORS
app.use(cors());

// Função para salvar resultados no banco de dados
async function saveResultsToDatabase(results) {
  const connection = await pool.getConnection();
  try {
    for (const card of results) {
      for (const result of card.results) {
        const [rows] = await connection.execute(
          `SELECT COUNT(1) AS Count FROM ResultadosLoteria WHERE Titulo = ? AND Hora = ? AND Premio = ?`,
          [card.title, card.time, result.prize]
        );

        if (rows[0].Count === 0) {
          await connection.execute(
            `INSERT INTO ResultadosLoteria (Titulo, Hora, Premio, Resultado, Grupo) VALUES (?, ?, ?, ?, ?)`,
            [card.title, card.time, result.prize, result.result, result.group]
          );
        } else {
          console.log(`Registro duplicado: ${card.title}, ${card.time}, ${result.prize}`);
        }
      }
    }
    console.log('Dados inseridos com sucesso!');
  } catch (error) {
    console.error('Erro ao salvar os resultados no banco:', error);
  } finally {
    connection.release();
  }
}

// Função para buscar os resultados
async function searchResults(page, date) {
  console.log(`Buscando resultados para a data: ${date}`);

  await page.evaluate((date) => {
    const dateInput = document.querySelector('.resultados__container-input--date input[type="date"]');
    if (dateInput) {
      dateInput.value = date;
      dateInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, date);

  try {
    await page.waitForSelector('.results__card', { timeout: 10000 });
    console.log('Resultados encontrados!');
    return await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.results__card'));
      return cards.map((card) => {
        const title = card.querySelector('.results__card--title span')?.innerText || 'Título não encontrado';
        const time = card.querySelector('.results__card--header > span')?.innerText || 'Hora não encontrada';
        const results = Array.from(card.querySelectorAll('tbody tr')).map((row) => ({
          prize: row.querySelector('td')?.innerText || 'Prêmio não encontrado',
          result: row.querySelector('.results__table-align-results')?.innerText.trim().split(' ').join(' ') || '(sem dados)',
          group: row.querySelector('.results__table-grupo span')?.innerText || 'Grupo não encontrado',
        }));
        return { title, time, results };
      });
    });
  } catch (error) {
    console.log('Nenhum resultado encontrado para esta data.');
    return null;
  }
}

// Função para realizar o scraping
async function scrapeWebsite() {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.goto('https://loteriasbr.com/', { waitUntil: 'networkidle2' });

    let currentDate = new Date();
    let results = null;

    for (let i = 0; i < 7; i++) {
      const formattedDate = currentDate.toISOString().split('T')[0];
      results = await searchResults(page, formattedDate);
      if (results && results.length > 0) {
        break;
      }
      currentDate.setDate(currentDate.getDate() - 1);
    }

    if (results && results.length > 0) {
      console.log('Dados coletados:', results);
      await saveResultsToDatabase(results);
    } else {
      console.log('Nenhum resultado encontrado nos últimos 7 dias.');
    }
  } catch (error) {
    console.error('Erro ao fazer scraping:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Rota para exibir os resultados
app.get('/results', async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const [rows] = await connection.execute(
      `SELECT Titulo, Hora, Premio, Resultado, Grupo, DATE_FORMAT(DataInsercao, '%d/%m/%Y') AS DataInsercao FROM ResultadosLoteria ORDER BY Hora DESC, DataInsercao DESC`
    );

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
  } finally {
    connection.release();
  }
});

// Função para rodar o scraping periodicamente a cada 1 minuto
const runScrapingPeriodically = async () => {
  setInterval(async () => {
    console.log("Iniciando scraping periodicamente...");
    await scrapeWebsite();  // Chama a função de scraping
  }, 15 * 60 * 1000);  // Executa a cada 15 minutos (15 * 60 * 1000ms)
};
// Iniciar o scraping periodicamente
runScrapingPeriodically();

// Rota inicial para teste
app.get('/', (req, res) => {
  res.send('Servidor funcionando corretamente!');
});

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
