// === Полноэкранный просмотр счёта ===
let currentScoreMatchId = null;

function openScoreOverlay(match) {
  currentScoreMatchId = match.id;
  document.getElementById('scorePlayer1Name').textContent = match.player1_name || 'Игрок 1';
  document.getElementById('scorePlayer2Name').textContent = match.player2_name || 'Игрок 2';
  document.getElementById('scoreMatchTitle').textContent = `Матч #${match.id}`;
  updateScoreOverlay(match);
  document.getElementById('scoreOverlay').classList.add('active');
}

function closeScoreOverlay() {
  document.getElementById('scoreOverlay').classList.remove('active');
  currentScoreMatchId = null;
}

function updateScoreOverlay(match) {
  if (!match) return;
  document.getElementById('scoreDisplay1').textContent = match.score1 || '0';
  document.getElementById('scoreDisplay2').textContent = match.score2 || '0';
}

// Закрытие по Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeScoreOverlay();
});

// === Глобальные переменные ===
let tournamentData = { name: '', stage: 'single', players: [], matches: [] };
let ws = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

// === Элементы DOM ===
const elements = {
  title: document.getElementById('title'),
  tournamentInfo: document.getElementById('tournamentInfo'),
  status: document.getElementById('status'),
  lastUpdate: document.getElementById('lastUpdate'),
  liveIndicator: document.getElementById('liveIndicator'),
  bracketType: document.getElementById('bracketType'),
  bracketContainer: document.getElementById('bracketContainer'),
  matchesContainer: document.getElementById('matchesContainer'),
  playersContainer: document.getElementById('playersContainer'),
  resultsContainer: document.getElementById('resultsContainer'),
  tabBtns: document.querySelectorAll('.tab-btn'),
  tabContents: document.querySelectorAll('.tab-content')
};

// === Инициализация ===
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  connectWS();
  fetchAndRender();
});

// === Переключение вкладок ===
function initTabs() {
  elements.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      
      elements.tabBtns.forEach(b => b.classList.remove('active'));
      elements.tabContents.forEach(c => c.classList.remove('active'));
      
      btn.classList.add('active');
      document.getElementById(tabName).classList.add('active');
    });
  });
}

// === Рендеринг всех данных ===
function render(data) {
  tournamentData = data;
  
  // Обновляем заголовок
  elements.title.textContent = data.name || 'Турнир';
  
  // Информация о турнире
  const stageNames = { single: 'Одиночная', double: 'Двойная', round: 'Круговая' };
  const playerCount = (data.players || []).length;
  const matchCount = (data.matches || []).length;
  const completedMatches = (data.matches || []).filter(m => m.status === 'Завершено').length;
  
  elements.tournamentInfo.textContent = `${playerCount} участников | ${matchCount} матчей | ${completedMatches} завершено`;
  
  // Рендерим все секции
  renderBracket(data);
  renderMatches(data);
  renderPlayers(data);
  renderResults(data);
  
  // Обновляем время
  updateLastUpdateTime();
}

// === Рендеринг сетки турнира ===
function renderBracket(data) {
  const { stage, matches } = data;
  const stageNames = { single: 'Одиночная', double: 'Двойная', round: 'Круговая' };
  
  elements.bracketType.textContent = `Формат: ${stageNames[stage] || 'Одиночная'}`;
  elements.bracketContainer.innerHTML = '';
  
  if (!matches || matches.length === 0) {
    elements.bracketContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🏆</div>
        <p>Сетка ещё не построена</p>
        <p style="font-size: 0.875rem; margin-top: 8px;">Добавьте участников и постройте сетку в приложении</p>
      </div>
    `;
    return;
  }
  
  // Для круговой системы - таблица
  if (stage === 'round') {
    renderRoundRobinBracket(matches);
    return;
  }
  
  // Для одиночной и двойной - древовидная структура
  const hasBrackets = matches.some(m => m.bracket);
  
  if (hasBrackets) {
    // Двойная сетка
    renderDoubleEliminationBracket(matches);
  } else {
    // Одиночная сетка
    renderSingleEliminationBracket(matches);
  }
}

function renderSingleEliminationBracket(matches) {
  const rounds = groupBy(matches, 'round');
  const roundNames = ['1/8 финала', '1/4 финала', 'Полуфинал', 'Финал', 'Победитель'];
  
  Object.keys(rounds).sort((a, b) => parseInt(a) - parseInt(b)).forEach(roundNum => {
    const roundDiv = document.createElement('div');
    roundDiv.className = 'round';
    
    const roundName = roundNames[parseInt(roundNum) - 1] || `Раунд ${roundNum}`;
    roundDiv.innerHTML = `<div class="round-header">${roundName}</div>`;
    
    rounds[roundNum].forEach(match => {
      const matchCard = createMatchCard(match);
      roundDiv.appendChild(matchCard);
    });
    
    elements.bracketContainer.appendChild(roundDiv);
  });
}

function renderDoubleEliminationBracket(matches) {
  const winners = matches.filter(m => m.bracket === 'W');
  const losers = matches.filter(m => m.bracket === 'L');
  
  if (winners.length > 0) {
    const winnersSection = document.createElement('div');
    winnersSection.className = 'bracket-section';
    winnersSection.innerHTML = '<div class="bracket-section-title">🏆 Сетка победителей</div>';
    
    const rounds = groupBy(winners, 'round');
    Object.keys(rounds).sort((a, b) => parseInt(a) - parseInt(b)).forEach(roundNum => {
      const roundDiv = document.createElement('div');
      roundDiv.className = 'round';
      roundDiv.innerHTML = `<div class="round-header">Раунд ${roundNum}</div>`;
      
      rounds[roundNum].forEach(match => {
        roundDiv.appendChild(createMatchCard(match));
      });
      
      winnersSection.appendChild(roundDiv);
    });
    
    elements.bracketContainer.appendChild(winnersSection);
  }
  
  if (losers.length > 0) {
    const losersSection = document.createElement('div');
    losersSection.className = 'bracket-section';
    losersSection.innerHTML = '<div class="bracket-section-title">💪 Сетка проигравших</div>';
    
    const rounds = groupBy(losers, 'round');
    Object.keys(rounds).sort((a, b) => parseInt(a) - parseInt(b)).forEach(roundNum => {
      const roundDiv = document.createElement('div');
      roundDiv.className = 'round';
      roundDiv.innerHTML = `<div class="round-header">Раунд ${roundNum}</div>`;
      
      rounds[roundNum].forEach(match => {
        roundDiv.appendChild(createMatchCard(match));
      });
      
      losersSection.appendChild(roundDiv);
    });
    
    elements.bracketContainer.appendChild(losersSection);
  }
}

function renderRoundRobinBracket(matches) {
  const rounds = groupBy(matches, 'round');
  
  Object.keys(rounds).sort((a, b) => parseInt(a) - parseInt(b)).forEach(roundNum => {
    const roundDiv = document.createElement('div');
    roundDiv.className = 'round';
    roundDiv.innerHTML = `<div class="round-header">Тур ${roundNum}</div>`;
    
    rounds[roundNum].forEach(match => {
      roundDiv.appendChild(createMatchCard(match));
    });
    
    elements.bracketContainer.appendChild(roundDiv);
  });
}

function createMatchCard(match) {
  const div = document.createElement('div');
  div.className = `match-card ${getStatusClass(match.status)}`;
  
  // Кликабельность: если матч не завершён, открываем счёт
  if (match.status !== 'Завершено' && match.player1_id && match.player2_id) {
    div.onclick = () => openScoreOverlay(match);
  }
  
  const statusLabels = { 'Завершено': 'completed', 'Ожидает': 'waiting', 'Готово': 'ready' };
  const statusLabel = statusLabels[match.status] || 'waiting';
  
  const p1Win = match.score1 && match.score2 && parseInt(match.score1) > parseInt(match.score2);
  const p2Win = match.score1 && match.score2 && parseInt(match.score2) > parseInt(match.score1);
  
  div.innerHTML = `
    <div class="match-header">
      <span class="match-id">Матч #${match.id}</span>
      <span class="match-status ${statusLabel}">${match.status || 'Ожидает'}</span>
    </div>
    <div class="player-row ${p1Win ? 'winner' : ''}">
      <span class="player-name">${escapeHtml(match.player1_name || '(пусто)')}</span>
      <span class="player-score">${match.score1 || '-'}</span>
    </div>
    <div class="player-row ${p2Win ? 'winner' : ''}">
      <span class="player-name">${escapeHtml(match.player2_name || '(пусто)')}</span>
      <span class="player-score">${match.score2 || '-'}</span>
    </div>
  `;
  
  return div;
}

function getStatusClass(status) {
  const classes = { 'Завершено': 'completed', 'Ожидает': 'waiting', 'Готово': 'ready' };
  return classes[status] || 'waiting';
}

// === Рендеринг всех матчей ===
function renderMatches(data) {
  const { matches } = data;
  elements.matchesContainer.innerHTML = '';
  
  if (!matches || matches.length === 0) {
    elements.matchesContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <p>Матчей пока нет</p>
      </div>
    `;
    return;
  }
  
  matches.forEach(match => {
    const item = document.createElement('div');
    item.className = `match-list-item ${getStatusClass(match.status)}`;
    
    // Кликабельность: если матч не завершён, открываем счёт
    if (match.status !== 'Завершено' && match.player1_id && match.player2_id) {
      item.onclick = () => openScoreOverlay(match);
    }
    
    const bracket = match.bracket ? `${match.bracket}-` : '';
    const round = `${bracket}Раунд ${match.round}`;
    
    item.innerHTML = `
      <div class="match-id">#${match.id}</div>
      <div class="match-list-players">
        <div class="player">
          <span class="player-name">${escapeHtml(match.player1_name || '(пусто)')}</span>
          <span class="player-score">${match.score1 || '-'}</span>
        </div>
        <div class="player">
          <span class="player-name">${escapeHtml(match.player2_name || '(пусто)')}</span>
          <span class="player-score">${match.score2 || '-'}</span>
        </div>
      </div>
      <div class="match-list-status">
        <span class="match-status ${getStatusClass(match.status)}">${match.status || 'Ожидает'}</span>
      </div>
      <div class="match-list-round">${round}</div>
    `;
    
    elements.matchesContainer.appendChild(item);
  });
}

// === Рендеринг участников ===
function renderPlayers(data) {
  const { players } = data;
  elements.playersContainer.innerHTML = '';
  
  if (!players || players.length === 0) {
    elements.playersContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">👥</div>
        <p>Участников пока нет</p>
        <p style="font-size: 0.875rem; margin-top: 8px;">Добавьте игроков в приложении</p>
      </div>
    `;
    return;
  }
  
  // Подсчитываем статистику по игрокам
  const playerStats = calculatePlayerStats(players, data.matches || []);
  
  players.forEach(player => {
    const stats = playerStats[player.id] || { wins: 0, losses: 0, matches: 0 };
    const card = document.createElement('div');
    card.className = 'player-card';
    
    const initials = getInitials(player.name);
    
    card.innerHTML = `
      <div class="player-card-header">
        <div class="player-avatar">${initials}</div>
        <div>
          <div class="player-card-name">${escapeHtml(player.name)}</div>
          <div class="player-card-club">${escapeHtml(player.club || 'Без клуба')}</div>
        </div>
      </div>
      <div class="player-card-rating">Рейтинг: ${escapeHtml(player.rating || '—')}</div>
      <div class="player-stats">
        <div class="stat">
          <div class="stat-value">${stats.matches}</div>
          <div class="stat-label">Матчей</div>
        </div>
        <div class="stat">
          <div class="stat-value">${stats.wins}</div>
          <div class="stat-label">Побед</div>
        </div>
        <div class="stat">
          <div class="stat-value">${stats.losses}</div>
          <div class="stat-label">Поражений</div>
        </div>
      </div>
    `;
    
    elements.playersContainer.appendChild(card);
  });
}

function calculatePlayerStats(players, matches) {
  const stats = {};
  
  players.forEach(p => {
    stats[p.id] = { wins: 0, losses: 0, matches: 0 };
  });
  
  matches.forEach(match => {
    if (match.status !== 'Завершено') return;
    
    const s1 = parseInt(match.score1) || 0;
    const s2 = parseInt(match.score2) || 0;
    
    if (match.player1_id && stats[match.player1_id]) {
      stats[match.player1_id].matches++;
      if (s1 > s2) stats[match.player1_id].wins++;
      else if (s2 > s1) stats[match.player1_id].losses++;
    }
    
    if (match.player2_id && stats[match.player2_id]) {
      stats[match.player2_id].matches++;
      if (s2 > s1) stats[match.player2_id].wins++;
      else if (s1 > s2) stats[match.player2_id].losses++;
    }
  });
  
  return stats;
}

function getInitials(name) {
  const parts = (name || '').split(' ');
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (name || '?').substring(0, 2).toUpperCase();
}

// === Рендеринг результатов ===
function renderResults(data) {
  const { matches } = data;
  elements.resultsContainer.innerHTML = '';
  
  const completedMatches = (matches || []).filter(m => m.status === 'Завершено');
  
  if (completedMatches.length === 0) {
    elements.resultsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🏅</div>
        <p>Завершённых матчей пока нет</p>
      </div>
    `;
    return;
  }
  
  completedMatches.forEach(match => {
    const s1 = parseInt(match.score1) || 0;
    const s2 = parseInt(match.score2) || 0;
    const p1Win = s1 > s2;
    const p2Win = s2 > s1;
    
    const card = document.createElement('div');
    card.className = 'result-card completed';
    
    const bracket = match.bracket ? `[${match.bracket}${match.round}] ` : '';
    
    card.innerHTML = `
      <div class="result-header">
        <span class="match-id">Матч #${match.id}</span>
        <span class="match-list-round">${bracket}Раунд ${match.round}</span>
      </div>
      <div class="result-players">
        <div class="result-player ${p1Win ? 'winner' : 'loser'}">
          <span>${escapeHtml(match.player1_name || '(пусто)')}</span>
        </div>
        <div class="result-score">${match.score1} : ${match.score2}</div>
        <div class="result-player ${p2Win ? 'winner' : 'loser'}">
          <span>${escapeHtml(match.player2_name || '(пусто)')}</span>
        </div>
      </div>
    `;
    
    elements.resultsContainer.appendChild(card);
  });
}

// === Вспомогательные функции ===
function groupBy(array, key) {
  return array.reduce((result, item) => {
    const value = item[key];
    if (!result[value]) result[value] = [];
    result[value].push(item);
    return result;
  }, {});
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function updateLastUpdateTime() {
  const now = new Date();
  elements.lastUpdate.textContent = 'Обновлено: ' + now.toLocaleTimeString('ru-RU');
}

// === WebSocket подключение ===
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  
  ws.onopen = () => {
    elements.status.textContent = 'Подключено (реальное время)';
    elements.status.className = 'connected';
    elements.liveIndicator.classList.add('active');
    reconnectAttempts = 0;
  };
  
  ws.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data);
      render(data);
      
      // Если открыт полноэкранный просмотр — обновляем счёт
      if (currentScoreMatchId !== null) {
        const match = (data.matches || []).find(m => m.id == currentScoreMatchId);
        if (match) {
          updateScoreOverlay(match);
          // Если матч завершился — показываем победителя
          if (match.status === 'Завершено') {
            document.getElementById('scoreMatchTitle').textContent = `Матч #${match.id} — ЗАВЕРШЁН`;
          }
        }
      }
    } catch (e) {
      console.error('Ошибка парсинга данных:', e);
    }
  };
  
  ws.onclose = () => {
    elements.status.textContent = 'Отключено';
    elements.status.className = 'disconnected';
    elements.liveIndicator.classList.remove('active');
    
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      setTimeout(() => {
        elements.status.textContent = `Переподключение... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`;
        elements.status.className = 'loading';
        connectWS();
      }, 2000);
    } else {
      elements.status.textContent = 'Ошибка подключения';
      fetchAndRender();
    }
  };
  
  ws.onerror = () => {
    elements.status.textContent = 'Ошибка соединения';
    elements.status.className = 'disconnected';
  };
}

// === Получение данных при старте ===
async function fetchAndRender() {
  elements.status.textContent = 'Загрузка...';
  elements.status.className = 'loading';
  
  try {
    const res = await fetch('/api/tournament');
    if (!res.ok) throw new Error('Нет данных');
    const data = await res.json();
    render(data);
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      elements.status.textContent = 'Подключено (реальное время)';
      elements.status.className = 'connected';
    } else {
      elements.status.textContent = 'Оффлайн (последние данные)';
      elements.status.className = 'disconnected';
    }
  } catch (e) {
    console.error('Ошибка загрузки:', e);
    elements.status.textContent = 'Нет данных';
    elements.status.className = 'disconnected';
    
    render({ name: 'Турнир', stage: 'single', players: [], matches: [] });
  }
}
