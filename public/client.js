class GnosiaGame {
    constructor() {
        this.socket = io();
        this.username = null;
        this.currentRoom = null;
        this.role = null;
        this.isHost = false;
        
        this.initializeEventListeners();
        this.socketEvents();
    }

    initializeEventListeners() {
        // 닉네임 설정
        document.getElementById('set-username-btn').addEventListener('click', () => {
            this.setUsername();
        });

        document.getElementById('username-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.setUsername();
            }
        });

        // 방 생성
        document.getElementById('create-room-btn').addEventListener('click', () => {
            this.createRoom();
        });

        // 게임 시작
        document.getElementById('start-game-btn').addEventListener('click', () => {
            this.startGame();
        });

        // 방 나가기
        document.getElementById('leave-room-btn').addEventListener('click', () => {
            this.leaveRoom();
        });

        // 게임 나가기
        document.getElementById('leave-game-btn').addEventListener('click', () => {
            this.leaveGame();
        });

        // 채팅 메시지 전송
        document.getElementById('send-message-btn').addEventListener('click', () => {
            this.sendMessage();
        });

        document.getElementById('message-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });

        // 투표 시작
        document.getElementById('start-voting-btn').addEventListener('click', () => {
            this.startVoting();
        });

        // 투표 취소
        document.getElementById('cancel-vote-btn').addEventListener('click', () => {
            this.hideVotingModal();
        });
    }

    socketEvents() {
        // 닉네임 설정 확인
        this.socket.on('usernameSet', (data) => {
            this.username = data.username;
            this.showRoomControls();
        });

        // 방 목록 업데이트
        this.socket.on('roomList', (rooms) => {
            this.updateRoomList(rooms);
        });

        this.socket.on('roomListUpdated', (rooms) => {
            this.updateRoomList(rooms);
        });

        // 방 생성 성공
        this.socket.on('roomCreated', (data) => {
            this.currentRoom = data.room;
            this.isHost = true;
            this.showWaitingRoom(data.room);
        });

        // 방 입장 성공
        this.socket.on('roomJoined', (data) => {
            this.currentRoom = data.room;
            this.isHost = this.currentRoom.host === this.socket.id;
            this.showWaitingRoom(data.room);
        });

        // 플레이어 입장
        this.socket.on('playerJoined', (data) => {
            this.updatePlayerList(data.players);
        });

        // 플레이어 퇴장
        this.socket.on('playerLeft', (data) => {
            this.updatePlayerList(data.players);
        });

        // 호스트 변경
        this.socket.on('hostChanged', (data) => {
            this.isHost = this.currentRoom.host === this.socket.id;
            this.updateHostDisplay(data.newHost);
        });

        // 방 나가기 확인
        this.socket.on('roomLeft', () => {
            this.currentRoom = null;
            this.isHost = false;
            this.showLobby();
        });

        // 게임 시작
        this.socket.on('gameStarted', (data) => {
            this.showGameScreen(data);
        });

        // 역할 배정
        this.socket.on('roleAssigned', (data) => {
            this.role = data.role;
            this.showRole();
        });

        // 채팅 메시지
        this.socket.on('chatMessage', (message) => {
            this.displayChatMessage(message);
        });

        // 투표 시작
        this.socket.on('votingStarted', (data) => {
            this.showVotingModal(data.players);
        });

        // 투표 제출 확인
        this.socket.on('voteSubmitted', (data) => {
            this.hideVotingModal();
            this.displaySystemMessage('투표를 완료했습니다.');
        });

        // 투표 결과
        this.socket.on('voteResult', (data) => {
            this.displayVoteResult(data);
        });

        // 다음 날
        this.socket.on('nextDay', (data) => {
            this.updateGameState(data);
        });

        // 게임 종료
        this.socket.on('gameEnded', (data) => {
            this.displayGameResult(data);
        });

        // 에러 처리
        this.socket.on('error', (message) => {
            alert(message);
        });
		
		this.socket.on('playerEliminated', (data) => {
            this.handlePlayerEliminated(data);
        });
    }

    handlePlayerEliminated(data) {
        // 채팅 입력 비활성화
        const messageInput = document.getElementById('message-input');
        const sendButton = document.getElementById('send-message-btn');
        
        messageInput.disabled = true;
        messageInput.placeholder = '제거되어 채팅을 할 수 없습니다.';
        sendButton.disabled = true;
        
        // 투표 버튼 숨기기 (호스트인 경우)
        const voteBtn = document.getElementById('start-voting-btn');
        if (voteBtn) {
            voteBtn.style.display = 'none';
        }
        
        this.displaySystemMessage(data.message);
    }
	
	
	
	
    setUsername() {
        const usernameInput = document.getElementById('username-input');
        const username = usernameInput.value.trim();
        
        if (username.length < 2) {
            alert('닉네임은 2자 이상 입력해주세요.');
            return;
        }
        
        this.socket.emit('setUsername', username);
    }

    showRoomControls() {
        document.getElementById('username-section').classList.add('hidden');
        document.getElementById('room-controls').classList.remove('hidden');
        
        // 방 목록 요청
        this.socket.emit('getRoomList');
    }

    createRoom() {
        const roomNameInput = document.getElementById('room-name-input');
        const maxPlayersSelect = document.getElementById('max-players');
        
        const roomName = roomNameInput.value.trim();
        const maxPlayers = maxPlayersSelect.value;
        
        if (roomName.length < 2) {
            alert('방 이름은 2자 이상 입력해주세요.');
            return;
        }
        
        this.socket.emit('createRoom', roomName, maxPlayers);
        roomNameInput.value = '';
    }

    joinRoom(roomId) {
        this.socket.emit('joinRoom', roomId);
    }

    updateRoomList(rooms) {
        const roomList = document.getElementById('room-list');
        
        if (rooms.length === 0) {
            roomList.innerHTML = '<div class="text-center">생성된 방이 없습니다.</div>';
            return;
        }
        
        roomList.innerHTML = rooms.map(room => `
            <div class="room-item" onclick="game.joinRoom('${room.id}')">
                <div class="room-info">
                    <div>
                        <strong>${room.name}</strong>
                        <div>인원: ${room.players.length}/${room.maxPlayers}</div>
                    </div>
                    <div>방장: ${room.players.find(p => p.socketId === room.host)?.username || '알 수 없음'}</div>
                </div>
            </div>
        `).join('');
    }

    showWaitingRoom(room) {
        document.getElementById('lobby').classList.remove('active');
        document.getElementById('waiting-room').classList.add('active');
        
        document.getElementById('room-name-display').textContent = room.name;
        document.getElementById('host-name').textContent = room.players.find(p => p.socketId === room.host)?.username || '알 수 없음';
        document.getElementById('player-count').textContent = room.players.length;
        document.getElementById('max-player-count').textContent = room.maxPlayers;
        
        this.updatePlayerList(room.players);
        this.updateHostControls();
    }

    updatePlayerList(players) {
        const playerList = document.getElementById('player-list');
        const hostId = this.currentRoom?.host;
        
        playerList.innerHTML = players.map(player => `
            <div class="player-item ${player.socketId === hostId ? 'host' : ''}">
                ${player.username}
                ${player.socketId === hostId ? '👑' : ''}
            </div>
        `).join('');
        
        if (this.currentRoom) {
            document.getElementById('player-count').textContent = players.length;
        }
    }

    updateHostDisplay(hostName) {
        document.getElementById('host-name').textContent = hostName;
        this.updateHostControls();
    }

    updateHostControls() {
        const hostControls = document.querySelectorAll('.host-only');
        hostControls.forEach(control => {
            control.style.display = this.isHost ? 'inline-block' : 'none';
        });
    }

    leaveRoom() {
        this.socket.emit('leaveRoom');
    }

    startGame() {
        this.socket.emit('startGame');
    }

    showGameScreen(data) {
        document.getElementById('waiting-room').classList.remove('active');
        document.getElementById('game-screen').classList.add('active');
        
        // 채팅 입력 활성화 (게임 시작 시 모든 플레이어는 활성 상태)
        const messageInput = document.getElementById('message-input');
        const sendButton = document.getElementById('send-message-btn');
        
        messageInput.disabled = false;
        messageInput.placeholder = '메시지를 입력하세요...';
        sendButton.disabled = false;
        
        this.updateGameState(data);
        this.updateGamePlayerList(this.currentRoom.players);
    }

    updateGameState(data) {
        document.getElementById('day-info').textContent = `Day ${data.day}`;
        document.getElementById('phase-info').textContent = this.getPhaseText(data.phase);
        
        // 투표 버튼 표시
        const voteBtn = document.getElementById('start-voting-btn');
        voteBtn.classList.toggle('hidden', data.phase !== 'discussion' || !this.isHost);
    }

    getPhaseText(phase) {
        const phases = {
            'discussion': '토론 중',
            'voting': '투표 중',
            'night': '밤',
            'ended': '게임 종료'
        };
        return phases[phase] || phase;
    }

    showRole() {
        const roleElement = document.getElementById('player-role');
        const roleInfo = document.getElementById('role-info');
        
        const roleNames = {
            'crew': '승무원',
            'gnosia': '그노시아'
        };
        
        roleElement.textContent = roleNames[this.role] || this.role;
        roleElement.className = `role-${this.role}`;
        roleInfo.classList.remove('hidden');
        
        this.displaySystemMessage(`당신의 역할은 ${roleNames[this.role]}입니다.`);
    }

    updateGamePlayerList(players) {
        const playerList = document.getElementById('game-player-list');
        
        playerList.innerHTML = players.map(player => {
            const isAlive = player.isAlive;
            const isMe = player.socketId === this.socket.id;
            const showRole = !isAlive || this.currentRoom.gameState === 'ended';
            
            let roleText = '';
            if (showRole) {
                roleText = player.role === 'crew' ? '승무원' : '그노시아';
            }
            
            return `
                <div class="game-player-item ${isAlive ? '' : 'dead'} ${isMe ? 'me' : ''}">
                    <span>${player.username} ${isMe ? '(나)' : ''}</span>
                    <span class="role-${player.role}">${roleText}</span>
                </div>
            `;
        }).join('');
    }

    sendMessage() {
        const messageInput = document.getElementById('message-input');
        const message = messageInput.value.trim();
        
        if (message.length === 0) return;
        
        this.socket.emit('sendMessage', message);
        messageInput.value = '';
    }

    displayChatMessage(message) {
        const chatMessages = document.getElementById('chat-messages');
        const messageElement = document.createElement('div');
        
        messageElement.className = `chat-message ${message.isSystem ? 'system' : ''}`;
        messageElement.innerHTML = `
            ${message.isSystem ? '' : `<strong>${message.username}:</strong> `}
            ${message.message}
            <small style="opacity: 0.7; margin-left: 10px;">${message.timestamp}</small>
        `;
        
        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    displaySystemMessage(message) {
        this.displayChatMessage({
            username: '시스템',
            message: message,
            timestamp: new Date().toLocaleTimeString(),
            isSystem: true
        });
    }

    startVoting() {
        this.socket.emit('startVoting');
    }

    showVotingModal(players) {
        const modal = document.getElementById('voting-modal');
        const options = document.getElementById('voting-options');
        
        options.innerHTML = players
            .filter(player => player.socketId !== this.socket.id)
            .map(player => `
                <div class="voting-option" onclick="game.submitVote('${player.socketId}')">
                    ${player.username}
                </div>
            `).join('');
        
        modal.classList.remove('hidden');
    }

    hideVotingModal() {
        document.getElementById('voting-modal').classList.add('hidden');
    }

    submitVote(playerId) {
        this.socket.emit('vote', playerId);
    }

    displayVoteResult(data) {
        const eliminatedName = data.eliminated.username;
        const eliminatedRole = data.eliminated.role === 'crew' ? '승무원' : '그노시아';
        
        this.displaySystemMessage(`${eliminatedName} 플레이어가 제거되었습니다. (역할: ${eliminatedRole})`);
        
        // 만약 제거된 플레이어가 자신이면 채팅 비활성화
        if (data.eliminated.socketId === this.socket.id) {
            this.handlePlayerEliminated({
                message: '당신은 제거되었습니다. 더 이상 채팅이나 투표에 참여할 수 없습니다.'
            });
        }
        
        // 플레이어 목록 업데이트
        this.updateGamePlayerList(this.currentRoom.players);
    }

    displayGameResult(data) {
        const winnerText = data.winner === 'crew' ? '승무원 팀' : '그노시아 팀';
        this.displaySystemMessage(`게임 종료! ${winnerText}의 승리!`);
        
        // 모든 플레이어의 역할 표시
        this.updateGamePlayerList(data.players);
        
        // 5초 후 대기실로 이동
        setTimeout(() => {
            this.leaveGame();
        }, 5000);
    }

    leaveGame() {
        this.socket.emit('leaveRoom');
        this.role = null;
        document.getElementById('role-info').classList.add('hidden');
        this.showLobby();
    }

    showLobby() {
        // 모든 화면 숨기기
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        
        // 로비 표시
        document.getElementById('lobby').classList.add('active');
        
        // 방 목록 새로고침
        this.socket.emit('getRoomList');
    }
}

// 게임 인스턴스 생성
const game = new GnosiaGame();