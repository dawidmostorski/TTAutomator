const fs = require('fs');
const path = require('path');

class ActionDatabase {
    constructor() {
        this.filePath = path.join(__dirname, 'history.json');
        this.data = this.load();
    }

    load() {
        try {
            if (fs.existsSync(this.filePath)) {
                return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            }
        } catch (e) {
            console.error('⚠️ Błąd ładowania bazy danych:', e.message);
        }
        // Domyślna struktura
        return {
            follows: [], // { username, timestamp, status }
            likes: []    // { username, description, timestamp }
        };
    }

    save() {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
        } catch (e) {
            console.error('⚠️ Błąd zapisu bazy danych:', e.message);
        }
    }

    /**
     * Rejestruje zaobserwowanie użytkownika
     */
    addFollow(username) {
        if (!username) return;

        // Sprawdź czy już nie ma wpisu (unikamy duplikatów w bazie)
        const exists = this.data.follows.find(f => f.username === username);
        if (!exists) {
            this.data.follows.push({
                username: username,
                timestamp: Date.now(),
                date: new Date().toLocaleString(),
                status: 'active' // active = obserwujemy, unfollowed = przestaliśmy
            });
            this.save();
            console.log(`💾 Zapisano w bazie Follow: ${username}`);
        }
    }

    /**
     * Rejestruje polubienie filmu
     */
    addLike(username, description) {
        this.data.likes.push({
            username: username || 'nieznany',
            description: description ? description.substring(0, 50) : '',
            timestamp: Date.now(),
            date: new Date().toLocaleString()
        });
        // Ograniczamy historię lajków do ostatnich 1000, żeby plik nie puchł
        if (this.data.likes.length > 1000) this.data.likes.shift();
        this.save();
    }

    /**
     * Zwraca listę użytkowników do odobserwowania (starszych niż X dni)
     */
    getUsersToUnfollow(daysOld = 3) {
        const cutoff = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
        return this.data.follows.filter(f =>
            f.status === 'active' && f.timestamp < cutoff
        );
    }

    /**
     * Oznacza użytkownika jako odobserwowanego
     */
    markAsUnfollowed(username) {
        const follow = this.data.follows.find(f => f.username === username);
        if (follow) {
            follow.status = 'unfollowed';
            follow.unfollowedAt = Date.now();
            follow.unfollowedDate = new Date().toLocaleString();
            this.save();
            console.log(`🗑️ Oznaczono w bazie jako Unfollowed: ${username}`);
        }
    }
}

module.exports = ActionDatabase;
