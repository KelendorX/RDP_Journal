const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
// Обслуживание статических файлов из папки public
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Инициализация БД с оптимизациями
const db = new sqlite3.Database('./rdp_journal.db', (err) => {
    if (err) {
        console.error('Ошибка подключения к БД:', err.message);
    } else {
        console.log('Подключено к SQLite базе данных');
        // Включаем WAL режим для лучшей производительности
        db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA cache_size = 10000; PRAGMA temp_store = MEMORY;', (err) => {
            if (err) console.error('Ошибка настройки PRAGMA:', err);
            else console.log('Оптимизации БД применены');
        });
        initDatabase();
    }
});

// Инициализация таблиц с дополнительными индексами
function initDatabase() {
    // Таблица пользователей
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        position TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) {
            console.error('Ошибка создания таблицы users:', err);
        }
    });

    // Таблица записей RDP с оптимизированной структурой
    db.run(`CREATE TABLE IF NOT EXISTS rdp_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        connection_date DATETIME NOT NULL,
        lpu TEXT NOT NULL,
        work_description TEXT NOT NULL,
        exit_time DATETIME,
        user_id INTEGER NOT NULL,
        source TEXT DEFAULT 'manual',
        session_id TEXT,
        connection_event_id INTEGER,
        disconnection_event_id INTEGER,
        original_server TEXT,
        duration TEXT,
        status TEXT DEFAULT 'Unknown',
        import_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`, (err) => {
        if (err) {
            console.error('Ошибка создания таблицы rdp_records:', err);
        } else {
            // Создаем все необходимые индексы после создания таблицы
            createIndexes();
        }
    });
    
    // Таблица маппинга IP адресов к ЛПУ
    db.run(`CREATE TABLE IF NOT EXISTS ip_lpu_mapping (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_address TEXT UNIQUE NOT NULL,
        lpu_name TEXT NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) {
            console.error('Ошибка создания таблицы ip_lpu_mapping:', err);
        }
    });

    // Таблица матрицы обновлений
    db.run(`CREATE TABLE IF NOT EXISTS update_matrix (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        update_name TEXT NOT NULL,
        user_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'not-ok',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(update_name, user_name)
    )`, (err) => {
        if (err) {
            console.error('Ошибка создания таблицы update_matrix:', err);
        }
    });

    console.log('База данных инициализирована');
}

// Функция для создания всех индексов
function createIndexes() {
    const indexes = [
        `CREATE INDEX IF NOT EXISTS idx_rdp_records_session_id ON rdp_records(session_id)`,
        `CREATE INDEX IF NOT EXISTS idx_rdp_records_connection_date ON rdp_records(connection_date)`,
        `CREATE INDEX IF NOT EXISTS idx_rdp_records_user_id ON rdp_records(user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_rdp_records_lpu ON rdp_records(lpu)`,
        `CREATE INDEX IF NOT EXISTS idx_rdp_records_import_time ON rdp_records(import_time)`,
        `CREATE INDEX IF NOT EXISTS idx_ip_lpu_mapping_ip ON ip_lpu_mapping(ip_address)`,
        `CREATE INDEX IF NOT EXISTS idx_update_matrix_lookup ON update_matrix(update_name, user_name)`
    ];
    
    let completed = 0;
    indexes.forEach((indexSql) => {
        db.run(indexSql, (err) => {
            if (err) {
                console.error('Ошибка создания индекса:', err);
            }
            completed++;
            if (completed === indexes.length) {
                console.log('Все индексы успешно созданы');
            }
        });
    });
}

// API Routes

// Аутентификация
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Имя пользователя и пароль обязательны' });
    }
    
    db.get(
        `SELECT id, username, role, COALESCE(position, '') as position FROM users WHERE username = ? AND password = ?`,
        [username, password],
        (err, row) => {
            if (err) {
                console.error('Ошибка базы данных при входе:', err);
                return res.status(500).json({ success: false, error: 'Ошибка сервера' });
            }
            if (row) {
                res.json({ success: true, user: row });
            } else {
                res.status(401).json({ success: false, error: 'Неверное имя пользователя или пароль' });
            }
        }
    );
});

// Получить всех пользователей (для администратора)
app.get('/api/users', (req, res) => {
    db.all(
        `SELECT id, username, role, COALESCE(position, '') as position, created_at FROM users ORDER BY username`,
        (err, rows) => {
            if (err) {
                console.error('Ошибка получения пользователей:', err);
                return res.status(500).json({ error: err.message });
            }
            res.json(rows);
        }
    );
});

// Обновить данные пользователя
app.put('/api/users/:id', (req, res) => {
    const id = req.params.id;
    const { username, role, position } = req.body;
    
    db.run(
        `UPDATE users 
        SET username = ?, role = ?, position = ? 
        WHERE id = ?`,
        [username, role, position || '', id],
        function(err) {
            if (err) {
                console.error('Ошибка обновления пользователя:', err);
                return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }
            res.json({ success: true, message: 'Данные пользователя успешно обновлены' });
        }
    );
});

// Получить все записи (для администратора) или записи пользователя - С ПАГИНАЦИЕЙ
app.get('/api/records', (req, res) => {
    const { userId, userRole, page = 1, limit = 100 } = req.query;
    
    let query = `
        SELECT r.*, u.username, COALESCE(u.position, '') as position 
        FROM rdp_records r 
        JOIN users u ON r.user_id = u.id
    `;
    let countQuery = `
        SELECT COUNT(*) as total 
        FROM rdp_records r 
        JOIN users u ON r.user_id = u.id
    `;
    let params = [];
    let whereClause = '';

    // Если не админ, показываем только записи пользователя
    if (userRole !== 'admin') {
        whereClause += ' WHERE r.user_id = ?';
        params.push(userId);
    }

    query += whereClause;
    countQuery += whereClause;
    
    // Добавляем сортировку
    query += ' ORDER BY r.connection_date DESC';
    
    // Добавляем пагинацию
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query += ' LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    // Выполняем запрос для получения записей
    db.all(query, params, (err, rows) => {
        if (err) {
            console.error('Ошибка получения записей:', err);
            return res.status(500).json({ error: err.message });
        }

        // Выполняем запрос для получения общего количества записей
        db.get(countQuery, params.slice(0, params.length - 2), (err, countResult) => {
            if (err) {
                console.error('Ошибка получения количества записей:', err);
                return res.status(500).json({ error: err.message });
            }

            res.json({
                records: rows,
                pagination: {
                    currentPage: parseInt(page),
                    limit: parseInt(limit),
                    totalRecords: countResult ? countResult.total : 0,
                    totalPages: Math.ceil((countResult ? countResult.total : 0) / parseInt(limit))
                }
            });
        });
    });
});

// Создать запись
app.post('/api/records', (req, res) => {
    const { connectionDate, lpu, workDescription, exitTime, userId, source, sessionId } = req.body;
    
    db.run(
        `INSERT INTO rdp_records 
        (connection_date, lpu, work_description, exit_time, user_id, source, session_id) 
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [connectionDate, lpu, workDescription, exitTime, userId, source || 'manual', sessionId],
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ 
                success: true, 
                id: this.lastID,
                message: 'Запись успешно добавлена'
            });
        }
    );
});

// Обновить запись
app.put('/api/records/:id', (req, res) => {
    const id = req.params.id;
    const { connectionDate, lpu, workDescription, exitTime } = req.body;
    
    db.run(
        `UPDATE rdp_records 
        SET connection_date = ?, lpu = ?, work_description = ?, exit_time = ? 
        WHERE id = ?`,
        [connectionDate, lpu, workDescription, exitTime, id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Запись не найдена' });
            }
            res.json({ success: true, message: 'Запись успешно обновлена' });
        }
    );
});

// Удалить запись
app.delete('/api/records/:id', (req, res) => {
    const id = req.params.id;
    
    db.run(
        `DELETE FROM rdp_records WHERE id = ?`,
        [id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Запись не найдена' });
            }
            res.json({ success: true, message: 'Запись успешно удалена' });
        }
    );
});

// Массовое добавление записей из логов (ОПТИМИЗИРОВАННАЯ ВЕРСИЯ)
app.post('/api/records/bulk', (req, res) => {
    const { records, userId } = req.body;
    
    if (!Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ error: 'Нет записей для добавления' });
    }

    // Начинаем транзакцию для массовой вставки
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        const stmt = db.prepare(`
            INSERT INTO rdp_records 
            (connection_date, lpu, work_description, exit_time, user_id, source, 
             session_id, connection_event_id, disconnection_event_id, original_server, duration, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        let insertedCount = 0;
        let errors = [];
        let totalRecords = records.length;

        records.forEach((record, index) => {
            stmt.run([
                record.connectionDate,
                record.lpu,
                record.workDescription,
                record.exitTime,
                userId,
                record.source || 'log_import',
                record.sessionId,
                record.connectionEventId,
                record.disconnectionEventId,
                record.originalServer,
                record.duration,
                record.status
            ], function(err) {
                if (err) {
                    console.error('Ошибка вставки записи:', err);
                    errors.push(`Запись ${index + 1}: ${err.message}`);
                } else {
                    insertedCount++;
                }
                
                // Проверяем, завершена ли обработка всех записей
                if (index === totalRecords - 1) {
                    stmt.finalize();
                    
                    // Завершаем транзакцию
                    db.run('COMMIT', (commitErr) => {
                        if (commitErr) {
                            console.error('Ошибка коммита:', commitErr);
                            db.run('ROLLBACK');
                            return res.status(500).json({ 
                                success: false, 
                                error: 'Ошибка сохранения данных' 
                            });
                        }
                        
                        if (errors.length > 0) {
                            res.json({ 
                                success: true, 
                                count: insertedCount,
                                errors: errors,
                                message: `Успешно добавлено ${insertedCount} из ${totalRecords} записей`
                            });
                        } else {
                            res.json({ 
                                success: true, 
                                count: insertedCount,
                                message: `Успешно добавлено ${insertedCount} записей`
                            });
                        }
                    });
                }
            });
        });
    });
});

// Проверить существующие session_id (ОПТИМИЗИРОВАННАЯ ВЕРСИЯ)
app.post('/api/records/check-sessions', (req, res) => {
    const { sessionIds } = req.body;
    
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
        return res.json([]);
    }

    // Разбиваем на части для избежания проблем с большими запросами
    const chunkSize = 500;
    const chunks = [];
    for (let i = 0; i < sessionIds.length; i += chunkSize) {
        chunks.push(sessionIds.slice(i, i + chunkSize));
    }
    
    const allExistingIds = [];
    let processedChunks = 0;
    
    chunks.forEach((chunk, chunkIndex) => {
        const placeholders = chunk.map(() => '?').join(',');
        const query = `SELECT session_id FROM rdp_records WHERE session_id IN (${placeholders})`;
        
        db.all(query, chunk, (err, rows) => {
            if (err) {
                console.error('Ошибка проверки session_ids:', err);
            }
            if (rows) {
                rows.forEach(row => allExistingIds.push(row.session_id));
            }
            
            processedChunks++;
            if (processedChunks === chunks.length) {
                res.json(allExistingIds);
            }
        });
    });
});

// Статистика для администратора
app.get('/api/stats', (req, res) => {
    const queries = {
        totalRecords: `SELECT COUNT(*) as count FROM rdp_records`,
        totalUsers: `SELECT COUNT(DISTINCT user_id) as count FROM rdp_records`,
        todayRecords: `SELECT COUNT(*) as count FROM rdp_records WHERE connection_date >= datetime('now', 'start of day', 'localtime')`
    };

    const results = {};
    let completed = 0;

    Object.keys(queries).forEach(key => {
        db.get(queries[key], (err, row) => {
            if (err) {
                console.error(`Ошибка запроса ${key}:`, err);
                results[key] = 0;
            } else {
                results[key] = row.count;
            }
            completed++;
            
            if (completed === Object.keys(queries).length) {
                res.json(results);
            }
        });
    });
});

// Получить список всех уникальных ЛПУ (ОПТИМИЗИРОВАННО)
app.get('/api/lpu-list', (req, res) => {
    const query = `
        SELECT DISTINCT lpu_name as lpu FROM ip_lpu_mapping 
        UNION 
        SELECT DISTINCT lpu FROM rdp_records 
        WHERE lpu IS NOT NULL AND lpu != 'Неизвестно' AND lpu != 'Сервер: null' AND lpu != ''
        ORDER BY lpu
    `;
    
    db.all(query, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        const lpuList = rows.map(row => row.lpu);
        res.json(lpuList);
    });
});

// Получить маппинг IP-ЛПУ
app.get('/api/ip-mapping', (req, res) => {
    db.all(
        `SELECT * FROM ip_lpu_mapping ORDER BY lpu_name, ip_address`,
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json(rows);
        }
    );
});

// Получить ЛПУ по IP адресу (ОПТИМИЗИРОВАННО)
app.get('/api/ip-mapping/:ip', (req, res) => {
    const ip = req.params.ip;
    
    db.get(
        `SELECT lpu_name, description FROM ip_lpu_mapping WHERE ip_address = ?`,
        [ip],
        (err, row) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (row) {
                res.json({ success: true, lpu: row.lpu_name, description: row.description });
            } else {
                res.json({ success: false, lpu: null });
            }
        }
    );
});

// Добавить новый маппинг IP-ЛПУ
app.post('/api/ip-mapping', (req, res) => {
    const { ip_address, lpu_name, description } = req.body;
    
    if (!ip_address || !lpu_name) {
        return res.status(400).json({ error: 'IP адрес и название ЛПУ обязательны' });
    }
    
    db.run(
        `INSERT INTO ip_lpu_mapping (ip_address, lpu_name, description) VALUES (?, ?, ?)`,
        [ip_address, lpu_name, description || ''],
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ 
                success: true, 
                id: this.lastID,
                message: 'Маппинг успешно добавлен'
            });
        }
    );
});

// Обновить маппинг IP-ЛПУ
app.put('/api/ip-mapping/:id', (req, res) => {
    const id = req.params.id;
    const { ip_address, lpu_name, description } = req.body;
    
    db.run(
        `UPDATE ip_lpu_mapping 
        SET ip_address = ?, lpu_name = ?, description = ? 
        WHERE id = ?`,
        [ip_address, lpu_name, description, id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Маппинг не найден' });
            }
            res.json({ success: true, message: 'Маппинг успешно обновлен' });
        }
    );
});

// Удалить маппинг IP-ЛПУ
app.delete('/api/ip-mapping/:id', (req, res) => {
    const id = req.params.id;
    
    db.run(
        `DELETE FROM ip_lpu_mapping WHERE id = ?`,
        [id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Маппинг не найден' });
            }
            res.json({ success: true, message: 'Маппинг успешно удален' });
        }
    );
});

// =========== API ДЛЯ МАТРИЦЫ ОБНОВЛЕНИЙ ===========

// Получить матрицу обновлений
app.get('/api/update-matrix', (req, res) => {
    // Получаем все записи из матрицы
    db.all(
        `SELECT update_name, user_name, status FROM update_matrix ORDER BY update_name, user_name`,
        (err, rows) => {
            if (err) {
                console.error('Ошибка получения матрицы обновлений:', err);
                return res.status(500).json({ error: err.message });
            }
            
            // Если в базе нет данных, возвращаем пустые данные
            if (rows.length === 0) {
                return getEmptyMatrixData(res);
            }
            
            // Формируем структуру матрицы
            const matrixData = {
                updates: [],
                users: [],
                statuses: {},
                isAdmin: false,
                canEdit: false
            };
            
            // Собираем уникальные обновления и пользователей
            const updateSet = new Set();
            const userSet = new Set();
            
            rows.forEach(row => {
                updateSet.add(row.update_name);
                userSet.add(row.user_name);
                
                if (!matrixData.statuses[row.update_name]) {
                    matrixData.statuses[row.update_name] = {};
                }
                matrixData.statuses[row.update_name][row.user_name] = row.status;
            });
            
            matrixData.updates = Array.from(updateSet).sort();
            matrixData.users = Array.from(userSet).sort();
            
            res.json(matrixData);
        }
    );
});

// Сохранить матрицу обновлений (ОПТИМИЗИРОВАННО)
app.post('/api/update-matrix', (req, res) => {
    const { updates, users, statuses } = req.body;
    
    if (!updates || !users || !statuses) {
        return res.status(400).json({ error: 'Неверный формат данных матрицы' });
    }
    
    // Начинаем транзакцию
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        // Очищаем таблицу
        db.run('DELETE FROM update_matrix', (err) => {
            if (err) {
                console.error('Ошибка очистки таблицы:', err);
                db.run('ROLLBACK');
                return res.status(500).json({ error: err.message });
            }
            
            // Если нет обновлений или пользователей, просто завершаем
            if (updates.length === 0 || users.length === 0) {
                db.run('COMMIT');
                return res.json({ success: true, message: 'Матрица успешно сохранена' });
            }
            
            // Подготавливаем запрос для вставки
            const stmt = db.prepare('INSERT INTO update_matrix (update_name, user_name, status) VALUES (?, ?, ?)');
            
            let inserted = 0;
            const total = updates.length * users.length;
            
            // Массовая вставка
            updates.forEach(update => {
                users.forEach(user => {
                    const status = statuses[update]?.[user] || 'not-ok';
                    stmt.run([update, user, status], (err) => {
                        if (err) {
                            console.error('Ошибка вставки данных:', err);
                        }
                        inserted++;
                        
                        // Когда все данные вставлены, завершаем
                        if (inserted === total) {
                            stmt.finalize();
                            db.run('COMMIT', (err) => {
                                if (err) {
                                    console.error('Ошибка коммита транзакции:', err);
                                    return res.status(500).json({ error: err.message });
                                }
                                res.json({ success: true, message: 'Матрица успешно сохранена' });
                            });
                        }
                    });
                });
            });
        });
    });
});

// Функция для получения пустых данных матрицы
function getEmptyMatrixData(res) {
    // Сопровождающие
    const initialUsers = ['Тестов', 'Тестов_2', 'Тестов_3', 'Тестов_4', 'Тестов_5', 'Тестов_6'];
    
    const matrixData = {
        updates: [],
        users: initialUsers,
        statuses: {},
        isAdmin: false,
        canEdit: false
    };
    
    res.json(matrixData);
}

// =========== КОНЕЦ API ДЛЯ МАТРИЦЫ ОБНОВЛЕНИЙ ===========

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log(`Откройте http://localhost:${PORT} в браузере`);
});