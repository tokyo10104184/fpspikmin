const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve the index.html file
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Store player data
const players = {};
let playerCount = 0;

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);
  playerCount++;

  // Add new player
  players[socket.id] = {
    id: socket.id,
    position: { x: playerCount * 5, y: 3.0, z: 10 }, // Offset x position
    rotation: { x: 0, y: 0, z: 0 }
  };

  // Send the current list of players to the new player
  socket.emit('currentPlayers', players);

  // Announce the new player to other players
  socket.broadcast.emit('newPlayer', players[socket.id]);

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // Remove player
    delete players[socket.id];
    // Announce player removal
    io.emit('playerDisconnected', socket.id);
  });

  // Handle player movement
  socket.on('playerMovement', (movementData) => {
    if (players[socket.id]) {
      players[socket.id].position = movementData.position;
      players[socket.id].rotation = movementData.rotation;
      // Broadcast the movement to other players
      socket.broadcast.emit('playerMoved', {
        id: socket.id,
        position: movementData.position,
        rotation: movementData.rotation
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
