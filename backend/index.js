import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import axios from 'axios';

const app = express();

const server = http.createServer(app);

const url = `https://realtimecodecompileer.onrender.com`;
const interval = 30000;

function reloadWebsite() {
  axios
    .get(url)
    .then((response) => {
      console.log("website reloded");
    })
    .catch((error) => {
      console.error(`Error : ${error.message}`);
    });
}

setInterval(reloadWebsite, interval);

const io = new Server(server,{
    cors:{
        origin:"*",
    },
});

const rooms = new Map();

// Map to store last compile time per room for rate limiting
const lastCompileTime = new Map();

io.on("connection",(socket)=>{
    console.log("User Connected ",socket.id);

    let currentRoom = null;
    let currentUser = null;

    socket.on("join",({roomId,userName})=>{
        if(currentRoom){
            socket.leave(currentRoom)
            rooms.get(currentRoom).delete(currentUser)
            io.to(currentRoom).emit("userJoined",Array.from(rooms.get(currentRoom).users));
        }

        currentRoom = roomId;
        currentUser = userName;

        socket.join(roomId)

        if(!rooms.has(roomId)){
            rooms.set(roomId,{users:new Set(),code:"// start code here"});
        }
        rooms.get(roomId).users.add(userName);

        socket.emit("codeUpdate",rooms.get(roomId).code);

        io.to(roomId).emit("userJoined",Array.from(rooms.get(currentRoom).users));

    });
    socket.on("codeChange",({roomId,code})=>{
        if(rooms.has(roomId)){
            rooms.get(roomId).code = code;

        }
        socket.to(roomId).emit("codeUpdate",code);
    });

    socket.on("leaveRoom",()=>{
        if(currentRoom && currentUser){
            rooms.get(currentRoom).users.delete(currentUser)
            io.to(currentRoom).emit("userJoined",Array.from(rooms.get(currentRoom).users));

            socket.leave(currentRoom)

            currentRoom= null;
            currentUser = null;
        }        
    });

    socket.on("typing",({roomId,userName})=>{
        socket.to(roomId).emit("userTyping",userName);
    });

    socket.on("languageChange",({roomId,language})=>{
        io.to(roomId).emit("languageUpdate",language);
    })

    socket.on("compileCode",async({code,roomId,language,version,input})=>{
        if(rooms.has(roomId)){
            const now = Date.now();
            const lastTime = lastCompileTime.get(roomId) || 0;
            const minInterval = 200; // 200ms minimum interval between requests

            if(now - lastTime < minInterval){
                // Too soon, send a rate limit message
                io.to(roomId).emit("codeResponse",{
                    error: "Rate limit exceeded. Please wait before compiling again.",
                });
                return;
            }

            lastCompileTime.set(roomId, now);

            const room = rooms.get(roomId);
            try {
                const response = await axios.post("https://emkc.org/api/v2/piston/execute",{
                    language,
                    version,
                    files:[
                        {
                            content:code,
                        }
                    ],
                    stdin:input,
                })
                room.output = response.data.run.output;
                io.to(roomId).emit("codeResponse",response.data);
            } catch(error) {
                if(error.response && error.response.status === 429){
                    io.to(roomId).emit("codeResponse",{
                        error: "API rate limit exceeded. Please try again later.",
                    });
                } else {
                    io.to(roomId).emit("codeResponse",{
                        error: "An error occurred while compiling the code.",
                    });
                }
            }
        }
    })

    socket.on("disconnect",()=>{
        if(currentRoom && currentUser){
            rooms.get(currentRoom).users.delete(currentUser)
            io.to(currentRoom).emit("userJoined",Array.from(rooms.get(currentRoom).users));
        }
        console.log("user Disconnected")
    })
})



const port = process.env.PORT || 5000;

const __dirname = path.resolve()

app.use(express.static(path.join(__dirname,"/frontend/dist")))


app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "dist", "index.html"));
});


server.listen(port,()=>{
    console.log('Server is working on Port 5000');
});
