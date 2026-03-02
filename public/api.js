class ApiService {
    constructor() {
        this.baseUrl = window.location.origin;
    }

    async request(endpoint, options = {}) {
        try {
            const config = {
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                ...options
            };

            if (options.body) {
                config.body = options.body;
            }

            const response = await fetch(`${this.baseUrl}/api${endpoint}`, config);

            if (!response.ok) {
                const errorText = await response.text();
                let errorData;
                try {
                    errorData = JSON.parse(errorText);
                } catch {
                    errorData = { error: errorText || `HTTP error! status: ${response.status}` };
                }
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    }

    // Аутентификация
    async login(username, password) {
        return this.request('/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
    }

    // Получить записи с пагинацией
    async getRecords(userId, userRole, page = 1, limit = 100) {
        return this.request(`/records?userId=${encodeURIComponent(userId)}&userRole=${encodeURIComponent(userRole)}&page=${page}&limit=${limit}`);
    }

    // Создать запись
    async createRecord(record) {
        return this.request('/records', {
            method: 'POST',
            body: JSON.stringify(record)
        });
    }

    // Обновить запись
    async updateRecord(id, record) {
        return this.request(`/records/${id}`, {
            method: 'PUT',
            body: JSON.stringify(record)
        });
    }

    // Удалить запись
    async deleteRecord(id) {
        return this.request(`/records/${id}`, {
            method: 'DELETE'
        });
    }

    // Массовое добавление
    async bulkCreateRecords(records, userId) {
        return this.request('/records/bulk', {
            method: 'POST',
            body: JSON.stringify({ records, userId })
        });
    }

    // Проверить session_id
    async checkExistingSessions(sessionIds) {
        return this.request('/records/check-sessions', {
            method: 'POST',
            body: JSON.stringify({ sessionIds })
        });
    }

    // Получить статистику
    async getStats() {
        return this.request('/stats');
    }

    // IP-ЛПУ маппинг методы
    async getIpMapping() {
        return this.request('/ip-mapping');
    }

    async getLpuByIp(ip) {
        return this.request(`/ip-mapping/${ip}`);
    }

    async createIpMapping(mapping) {
        return this.request('/ip-mapping', {
            method: 'POST',
            body: JSON.stringify(mapping)
        });
    }

    async updateIpMapping(id, mapping) {
        return this.request(`/ip-mapping/${id}`, {
            method: 'PUT',
            body: JSON.stringify(mapping)
        });
    }

    async deleteIpMapping(id) {
        return this.request(`/ip-mapping/${id}`, {
            method: 'DELETE'
        });
    }

    // Получить список ЛПУ
    async getLpuList() {
        return this.request('/lpu-list');
    }

    // Получить всех пользователей
    async getUsers() {
        return this.request('/users');
    }

    // Обновить пользователя
    async updateUser(id, userData) {
        return this.request(`/users/${id}`, {
            method: 'PUT',
            body: JSON.stringify(userData)
        });
    }

    // Методы для работы с матрицей обновлений
    async getUpdateMatrix() {
        return this.request('/update-matrix');
    }

    async saveUpdateMatrix(matrixData) {
        return this.request('/update-matrix', {
            method: 'POST',
            body: JSON.stringify(matrixData)
        });
    }
}

// Создаем глобальный экземпляр API
window.apiService = new ApiService();