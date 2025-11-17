const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// 정적 파일 서비스
app.use(express.static(path.join(__dirname, '../public')));

// 전역 상태 관리
const rooms = new Map();
const players = new Map();

// 룸 ID 생성 함수
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// 서버 이벤트 핸들러
io.on('connection', (socket) => {
  console.log('새로운 플레이어 연결:', socket.id);
  
  // 플레이어 정보 저장 (초기)
  players.set(socket.id, {
    socketId: socket.id,
    username: null,
    roomId: null
  });

  // 닉네임 설정
  socket.on('setUsername', (username) => {
    const player = players.get(socket.id);
    if (player) {
      player.username = username;
      console.log(`플레이어 ${socket.id} 닉네임 설정: ${username}`);
      socket.emit('usernameSet', { username });
    }
  });

  // 방 생성
  socket.on('createRoom', (roomName, maxPlayers = 8) => {
    const player = players.get(socket.id);
    if (!player || !player.username) {
      socket.emit('error', '먼저 닉네임을 설정해주세요.');
      return;
    }

    const roomId = generateRoomId();
    const room = {
      id: roomId,
      name: roomName,
      host: socket.id,
      players: [],
      maxPlayers: parseInt(maxPlayers),
      gameState: 'waiting',
      day: 1,
      votes: {},
      settings: {
        discussionTime: 180, // 3분
        voteTime: 60 // 1분
      }
    };

    // 플레이어를 방에 추가
    const playerData = {
      socketId: socket.id,
      username: player.username,
      role: null,
      isAlive: true,
      votes: 0
    };
    
    room.players.push(playerData);
    rooms.set(roomId, room);
    player.roomId = roomId;

    socket.join(roomId);
    socket.emit('roomCreated', { roomId, room });
    io.emit('roomListUpdated', Array.from(rooms.values()).filter(room => room.gameState === 'waiting'));
    
    console.log(`방 생성: ${roomId} - ${roomName}`);
  });

  // 방 입장
  socket.on('joinRoom', (roomId) => {
    const player = players.get(socket.id);
    const room = rooms.get(roomId);

    if (!player || !player.username) {
      socket.emit('error', '먼저 닉네임을 설정해주세요.');
      return;
    }

    if (!room) {
      socket.emit('error', '방을 찾을 수 없습니다.');
      return;
    }

    if (room.gameState !== 'waiting') {
      socket.emit('error', '이미 게임이 진행중인 방입니다.');
      return;
    }

    if (room.players.length >= room.maxPlayers) {
      socket.emit('error', '방이 가득 찼습니다.');
      return;
    }

    // 플레이어를 방에 추가
    const playerData = {
      socketId: socket.id,
      username: player.username,
      role: null,
      isAlive: true,
      votes: 0
    };
    
    room.players.push(playerData);
    player.roomId = roomId;

    socket.join(roomId);
    socket.emit('roomJoined', { room });
    socket.to(roomId).emit('playerJoined', { 
      player: playerData, 
      players: room.players 
    });
    
    io.emit('roomListUpdated', Array.from(rooms.values()).filter(room => room.gameState === 'waiting'));
    console.log(`플레이어 ${player.username} 방 ${roomId} 입장`);
  });

  // 방 나가기
  socket.on('leaveRoom', () => {
    const player = players.get(socket.id);
    if (!player || !player.roomId) return;

    const room = rooms.get(player.roomId);
    if (!room) return;

    // 플레이어 제거
    room.players = room.players.filter(p => p.socketId !== socket.id);
    player.roomId = null;

    // 방이 비었으면 삭제
    if (room.players.length === 0) {
      rooms.delete(room.id);
    } else {
      // 호스트 재설정
      if (room.host === socket.id) {
        room.host = room.players[0].socketId;
        io.to(room.id).emit('hostChanged', { newHost: room.players[0].username });
      }
      
      socket.to(room.id).emit('playerLeft', { 
        playerId: socket.id, 
        players: room.players 
      });
    }

    socket.leave(room.id);
    socket.emit('roomLeft');
    io.emit('roomListUpdated', Array.from(rooms.values()).filter(room => room.gameState === 'waiting'));
    
    console.log(`플레이어 ${socket.id} 방 나감`);
  });

  // 게임 시작
  socket.on('startGame', () => {
    const player = players.get(socket.id);
    if (!player || !player.roomId) return;

    const room = rooms.get(player.roomId);
    if (!room) return;

    // 호스트 확인
    if (room.host !== socket.id) {
      socket.emit('error', '호스트만 게임을 시작할 수 있습니다.');
      return;
    }

    // 최소 인원 확인
    if (room.players.length < 4) {
      socket.emit('error', '최소 4명이 필요합니다.');
      return;
    }

    // 역할 배정
    const numGnosia = Math.max(1, Math.floor(room.players.length / 3));
    const shuffled = [...room.players].sort(() => Math.random() - 0.5);
    
    shuffled.forEach((player, index) => {
      player.role = index < numGnosia ? 'gnosia' : 'crew';
      player.isAlive = true;
    });

    room.gameState = 'discussion';
    room.day = 1;
    room.votes = {};

    // 각 플레이어에게 역할 전송
    room.players.forEach(player => {
      io.to(player.socketId).emit('roleAssigned', {
        role: player.role
      });
    });

    // 방 전체에 게임 시작 알림
    io.to(room.id).emit('gameStarted', {
      day: room.day,
      phase: 'discussion',
      players: room.players.map(p => ({ 
        socketId: p.socketId, 
        username: p.username, 
        isAlive: p.isAlive 
      }))
    });
    
    console.log(`방 ${room.id} 게임 시작`);
  });

  // 채팅 메시지
// 채팅 메시지 핸들러 수정
  socket.on('sendMessage', (message) => {
    const player = players.get(socket.id);
    if (!player || !player.roomId) return;
  
    const room = rooms.get(player.roomId);
    if (!room) return;
  
    // 제거된 플레이어 체크
    const currentPlayer = room.players.find(p => p.socketId === socket.id);
    if (!currentPlayer || !currentPlayer.isAlive) {
      socket.emit('error', '제거된 플레이어는 채팅을 할 수 없습니다.');
      return;
    }
  
    // 게임 상태에 따른 메시지 제한
    if (room.gameState === 'night') {
      socket.emit('error', '밤에는 채팅을 할 수 없습니다.');
      return;
    }
  
    const chatMessage = {
      playerId: socket.id,
      username: player.username,
      message: message,
      timestamp: new Date().toLocaleTimeString(),
      isSystem: false
    };
  
    io.to(room.id).emit('chatMessage', chatMessage);
  });
  
  // 투표 결과 처리 부분 수정 - 제거된 플레이어에게 알림 추가
  socket.on('vote', (votedPlayerId) => {
    const player = players.get(socket.id);
    if (!player || !player.roomId) return;
  
    const room = rooms.get(player.roomId);
    if (!room) return;
  
    // 투표 가능 상태 확인
    if (room.gameState !== 'voting') {
      socket.emit('error', '지금은 투표 시간이 아닙니다.');
      return;
    }
  
    const voter = room.players.find(p => p.socketId === socket.id);
    if (!voter || !voter.isAlive) {
      socket.emit('error', '제거된 플레이어는 투표할 수 없습니다.');
      return;
    }
  
    // 투표 기록
    room.votes[socket.id] = votedPlayerId;
    socket.emit('voteSubmitted', { votedPlayerId });
  
    // 모든 생존 플레이어가 투표했는지 확인
    const alivePlayers = room.players.filter(p => p.isAlive);
    const votedCount = Object.keys(room.votes).length;
  
    if (votedCount === alivePlayers.length) {
      // 투표 집계
      const voteCounts = {};
      Object.values(room.votes).forEach(votedId => {
        voteCounts[votedId] = (voteCounts[votedId] || 0) + 1;
      });
  
      // 최다 득표자 찾기
      let maxVotes = 0;
      let eliminatedId = null;
      
      Object.entries(voteCounts).forEach(([playerId, count]) => {
        if (count > maxVotes) {
          maxVotes = count;
          eliminatedId = playerId;
        }
      });
  
      // 동점 처리 (랜덤 제거)
      const topVoted = Object.entries(voteCounts).filter(([_, count]) => count === maxVotes);
      if (topVoted.length > 1) {
        eliminatedId = topVoted[Math.floor(Math.random() * topVoted.length)][0];
      }
  
      // 제거 처리
      const eliminatedPlayer = room.players.find(p => p.socketId === eliminatedId);
      if (eliminatedPlayer) {
        eliminatedPlayer.isAlive = false;
        
        // 제거된 플레이어에게 알림
        io.to(eliminatedPlayer.socketId).emit('playerEliminated', {
          message: '당신은 제거되었습니다. 더 이상 채팅이나 투표에 참여할 수 없습니다.'
        });
        
        // 결과 브로드캐스트
        io.to(room.id).emit('voteResult', {
          eliminated: {
            socketId: eliminatedPlayer.socketId,
            username: eliminatedPlayer.username,
            role: eliminatedPlayer.role
          },
          voteCounts: voteCounts
        });
  
        // 게임 종료 체크
        const alive = room.players.filter(p => p.isAlive);
        const aliveGnosia = alive.filter(p => p.role === 'gnosia');
        const aliveCrew = alive.filter(p => p.role === 'crew');
        
        let gameEnded = false;
        let winner = null;
  
        if (aliveGnosia.length === 0) {
          gameEnded = true;
          winner = 'crew';
        } else if (aliveGnosia.length >= aliveCrew.length) {
          gameEnded = true;
          winner = 'gnosia';
        }
  
        if (gameEnded) {
          io.to(room.id).emit('gameEnded', {
            winner: winner,
            players: room.players.map(p => ({
              socketId: p.socketId,
              username: p.username,
              role: p.role,
              isAlive: p.isAlive
            }))
          });
          room.gameState = 'ended';
        } else {
          // 다음 날로
          room.day++;
          room.votes = {};
          room.gameState = 'discussion';
          
          io.to(room.id).emit('nextDay', {
            day: room.day,
            phase: 'discussion'
          });
        }
      }
    }
  });

  // 투표 시작
  socket.on('startVoting', () => {
    const player = players.get(socket.id);
    if (!player || !player.roomId) return;

    const room = rooms.get(player.roomId);
    if (!room) return;

    // 호스트 확인
    if (room.host !== socket.id) {
      socket.emit('error', '호스트만 투표를 시작할 수 있습니다.');
      return;
    }

    room.gameState = 'voting';
    room.votes = {};

    io.to(room.id).emit('votingStarted', {
      players: room.players.filter(p => p.isAlive).map(p => ({
        socketId: p.socketId,
        username: p.username
      }))
    });
  });

  // 연결 해제
  socket.on('disconnect', () => {
    console.log('플레이어 연결 해제:', socket.id);
    
    const player = players.get(socket.id);
    if (player && player.roomId) {
      // 방 나가기 처리
      const room = rooms.get(player.roomId);
      if (room) {
        room.players = room.players.filter(p => p.socketId !== socket.id);
        
        if (room.players.length === 0) {
          rooms.delete(room.id);
        } else {
          if (room.host === socket.id) {
            room.host = room.players[0].socketId;
            io.to(room.id).emit('hostChanged', { newHost: room.players[0].username });
          }
          
          socket.to(room.id).emit('playerLeft', { 
            playerId: socket.id, 
            players: room.players 
          });
        }
        
        io.emit('roomListUpdated', Array.from(rooms.values()).filter(room => room.gameState === 'waiting'));
      }
    }
    
    players.delete(socket.id);
  });

  // 방 목록 요청
  socket.on('getRoomList', () => {
    const waitingRooms = Array.from(rooms.values()).filter(room => room.gameState === 'waiting');
    socket.emit('roomList', waitingRooms);
  });
});

// 서버 시작
const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`서버 실행: http://0.0.0.0:${PORT}`);
});
