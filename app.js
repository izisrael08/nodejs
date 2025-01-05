  // Importando as dependências
  const express = require('express');
  const path = require('path');
  const puppeteer = require('puppeteer');
  const cors = require('cors'); // Importa o middleware CORS
  const mysql = require('mysql2/promise');
  require('dotenv').config();

  // Criando a instância do Express
  const app = express();
  const router = express.Router();

  // Conexão com o banco de dados
  const pool = mysql.createPool({
      uri: process.env.DATABASE_URL
  });


  // Middleware para servir arquivos estáticos
  app.use(express.static(path.join(__dirname, 'public')));

  // Função para salvar resultados no banco de dados
  async function saveResultsToDatabase(results) {
      const connection = await pool.getConnection();
      try {
          for (const card of results) {
              for (const result of card.results) {
                  const [rows] = await connection.execute(`
                      SELECT COUNT(1) AS Count
                      FROM ResultadosLoteria
                      WHERE Titulo = ? AND Hora = ? AND Premio = ?`, 
                      [card.title, card.time, result.prize]);

                  if (rows[0].Count === 0) {
                      await connection.execute(`
                          INSERT INTO ResultadosLoteria (Titulo, Hora, Premio, Resultado, Grupo)
                          VALUES (?, ?, ?, ?, ?)`, 
                          [card.title, card.time, result.prize, result.result, result.group]);
                  } else {
                      console.log(`Registro duplicado encontrado: ${card.title}, ${card.time}, ${result.prize}`);
                  }
              }
          }
          console.log("Dados inseridos com sucesso!");
      } catch (error) {
          console.error("Erro ao salvar os resultados no banco:", error);
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
          await page.waitForSelector(".results__card", { timeout: 10000 });
          console.log("Resultados encontrados!");
          return await page.evaluate(() => {
              const cards = Array.from(document.querySelectorAll(".results__card"));
              return cards.map(card => {
                  const titleElement = card.querySelector(".results__card--title span");
                  const timeElement = card.querySelector(".results__card--header > span");
                  const tableRows = card.querySelectorAll("tbody tr");

                  const title = titleElement ? titleElement.innerText : "Título não encontrado";
                  const time = timeElement ? timeElement.innerText : "Hora não encontrada";

                  const resultData = Array.from(tableRows).map(row => {
                      const prizeElement = row.querySelector("td");
                      const groupElement = row.querySelector(".results__table-grupo span");
                      const resultElements = row.querySelector(".results__table-align-results");

                      const prize = prizeElement ? prizeElement.innerText : "Prêmio não encontrado";
                      const result = resultElements ? resultElements.innerText.trim().split(" ").join(" ") : "(sem dados)";
                      const group = groupElement ? groupElement.innerText : "Grupo não encontrado";

                      return { prize, result, group };
                  }).filter(data => data.prize);

                  return { title, time, results: resultData };
              });
          });
      } catch (error) {
          console.log("Nenhum resultado encontrado para esta data.");
          return null;
      }
  }

  // Função para realizar o scraping
  async function scrapeWebsite() {
      let browser;
      try {
          browser = await puppeteer.launch({ headless: true });
          const page = await browser.newPage();
          await page.goto("https://loteriasbr.com/", { waitUntil: "networkidle2" });

          let currentDate = new Date();
          let results = null;

          for (let i = 0; i < 7; i++) {
              const formattedDate = currentDate.toISOString().split("T")[0];
              results = await searchResults(page, formattedDate);
              if (results && results.length > 0) {
                  break;
              }
              currentDate.setDate(currentDate.getDate() - 1);
          }

          if (results && results.length > 0) {
              console.log("Dados coletados:", results);
              await saveResultsToDatabase(results);
          } else {
              console.log("Nenhum resultado encontrado nos últimos 7 dias.");
          }
      } catch (error) {
          console.error("Erro ao fazer scraping:", error);
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
          const [rows] = await connection.execute(`
              SELECT Titulo, Hora, Premio, Resultado, Grupo, DATE_FORMAT(DataInsercao, '%d/%m/%Y') AS DataInsercao
              FROM ResultadosLoteria
              ORDER BY Hora DESC, DataInsercao DESC
          `);

          const groupedResults = rows.reduce((acc, current) => {
              const key = `${current.Titulo}-${current.Hora}`;
              if (!acc[key]) {
                  acc[key] = {
                      Titulo: current.Titulo,
                      Hora: current.Hora,
                      Dia: current.DataInsercao,
                      Resultados: []
                  };
              }
              acc[key].Resultados.push({
                  Premio: current.Premio,
                  Resultado: current.Resultado,
                  Grupo: current.Grupo
              });
              return acc;
          }, {});

          const formattedResults = Object.values(groupedResults).map(card => ({
              Titulo: card.Titulo,
              Hora: card.Hora,
              Dia: card.Dia,
              Resultados: card.Resultados
          }));

          res.json(formattedResults);
      } catch (error) {
          res.status(500).json({ message: 'Erro ao recuperar os resultados', error: error.message });
      } finally {
          connection.release();
      }
  });


  //Função para rodar o scraping periodicamente a cada 15 minutos
  // const runScrapingPeriodically = async () => {
  //   setInterval(async () => {
  //       console.log("Iniciando scraping...");
  //       await scrapeWebsite();  // Chama a função de scraping
  //   }, 15 * 60 * 1000);  // Executa a cada 15 minutos (15 * 60 * 1000ms)
  // };
  // Função para rodar o scraping periodicamente a cada 1 minuto
  const runScrapingPeriodically = async () => {
    setInterval(async () => {
        console.log("Iniciando scraping periodicamente...");
        await scrapeWebsite();  // Chama a função de scraping
    }, 1 * 60 * 1000);  // Executa a cada 1 minuto (1 * 60 * 1000ms)
  };


  // Iniciar o scraping periodicamente
  runScrapingPeriodically();

  // Iniciar o servidor
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
  });

