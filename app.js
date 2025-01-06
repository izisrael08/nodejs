const puppeteer = require('puppeteer');
const mysql = require('mysql2/promise');
const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();

// Conexão com o banco de dados usando as variáveis de ambiente
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.PORT || 3306,
  connectionLimit: 10,
  connectTimeout: 30000  // Timeout de 30 segundos
});


// Middleware para servir arquivos estáticos (como index.html) da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// Função para salvar resultados no banco de dados
async function saveResultsToDatabase(results) {
    const connection = await pool.getConnection(); // Pega uma conexão do pool
    try {
        for (const card of results) {
            for (const result of card.results) {
                const [rows] = await connection.execute(`
                    SELECT COUNT(1) AS Count
                    FROM ResultadosLoteria
                    WHERE Titulo = ? AND Hora = ? AND Premio = ?
                `, [card.title, card.time, result.prize]);

                if (rows[0].Count === 0) {
                    await connection.execute(`
                        INSERT INTO ResultadosLoteria (Titulo, Hora, Premio, Resultado, Grupo)
                        VALUES (?, ?, ?, ?, ?)
                    `, [card.title, card.time, result.prize, result.result, result.group]);
                } else {
                    console.log(`Registro duplicado encontrado: ${card.title}, ${card.time}, ${result.prize}`);
                }
            }
        }
        console.log("Dados inseridos com sucesso!");
    } catch (error) {
        console.error("Erro ao salvar os resultados no banco:", error);
    } finally {
        connection.release(); // Libera a conexão de volta para o pool
    }
}

// Função para ajustar a data no campo e buscar resultados
async function searchResults(page, date) {
    console.log(`Buscando resultados para a data: ${date}`);
    
    // Define a data no campo de entrada
    await page.evaluate((date) => {
        const dateInput = document.querySelector('.resultados__container-input--date input[type="date"]');
        if (dateInput) {
            dateInput.value = date;
            dateInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }, date);

    // Aguarda os resultados após alterar a data
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

        // Tenta buscar resultados até encontrar ou alcançar uma data limite (ex.: 7 dias atrás)
        for (let i = 0; i < 7; i++) {
            const formattedDate = currentDate.toISOString().split("T")[0]; // Formata para 'YYYY-MM-DD'
            results = await searchResults(page, formattedDate);
            if (results && results.length > 0) {
                break; // Sai do loop se encontrar resultados
            }
            // Ajusta para o dia anterior
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

// Função para verificar se o banco de dados está vazio
async function checkIfDatabaseIsEmpty() {
    const connection = await pool.getConnection(); // Pega uma conexão do pool
    try {
        const [rows] = await connection.execute(`
            SELECT COUNT(1) AS Count
            FROM ResultadosLoteria
        `);

        return rows[0].Count === 0; // Retorna verdadeiro se o banco estiver vazio
    } catch (error) {
        console.error("Erro ao verificar dados no banco:", error);
        return true; // Retorna verdadeiro em caso de erro
    } finally {
        connection.release(); // Libera a conexão de volta para o pool
    }
}

// Função para rodar o scraper periodicamente
async function runScraperPeriodically() {
    console.log("Iniciando verificação de dados no banco...");

    const isDatabaseEmpty = await checkIfDatabaseIsEmpty();

    if (isDatabaseEmpty) {
        console.log("Banco de dados vazio, iniciando o scraping...");
        await scrapeWebsite(); // Executa o scraper se o banco estiver vazio
    } else {
        console.log("Banco de dados já contém dados, não será necessário fazer o scraping.");
    }

    // Agora, sempre que o banco já tiver dados, busca novos dados
    console.log("Buscando novos dados para atualização...");
    await scrapeWebsite(); // Executa o scraping para buscar novos dados
}

// Função para iniciar o scraper na inicialização
async function initializeScraper() {
    const isDatabaseEmpty = await checkIfDatabaseIsEmpty();
    if (isDatabaseEmpty) {
        console.log("Banco de dados vazio, iniciando a inicialização do scraper...");
        await scrapeWebsite(); // Realiza o scraping para popular o banco de dados
    } else {
        console.log("Banco de dados já contém dados, sem necessidade de inicialização.");
    }
}

// Executa a verificação de inicialização ao iniciar o servidor
initializeScraper();

// Configura a execução periódica a cada 10 minutos
setInterval(runScraperPeriodically, 1 * 60 * 1000); // 10 minutos em milissegundos

// Rota para exibir os resultados do banco de dados
app.get('/results', async (req, res) => {
    const connection = await pool.getConnection(); // Pega uma conexão do pool

    try {
        const [rows] = await connection.execute(`
            SELECT 
                Titulo,
                Hora,
                Premio,
                Resultado,
                Grupo,
                DATE_FORMAT(DataInsercao, '%d/%m/%Y') AS DataInsercao
            FROM ResultadosLoteria
            ORDER BY Hora DESC, DataInsercao DESC
        `);

        // Agrupando os resultados corretamente, sem mistura
        const groupedResults = rows.reduce((acc, current) => {
            // Cria uma chave única para cada conjunto de resultados
            const key = `${current.Titulo}-${current.Hora}`;

            if (!acc[key]) {
                acc[key] = {
                    Titulo: current.Titulo,
                    Hora: current.Hora,
                    Dia: current.DataInsercao,
                    Resultados: []
                };
            }

            // Adiciona o prêmio, resultado e grupo ao grupo correto
            acc[key].Resultados.push({
                Premio: current.Premio,
                Resultado: current.Resultado,
                Grupo: current.Grupo
            });

            return acc;
        }, {});

        // Transforma o objeto agrupado em um array
        const formattedResults = Object.values(groupedResults).map(card => ({
            Titulo: card.Titulo,
            Hora: card.Hora,
            Dia: card.Dia,
            Resultados: card.Resultados
        }));

        // Retorna os resultados formatados como JSON
        res.json(formattedResults);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao recuperar os resultados', error: error.message });
    } finally {
        connection.release(); // Libera a conexão de volta para o pool
    }
});

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
