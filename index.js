require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const port = process.env.PORT || 5000;
const server = http.createServer(app);

// middleware
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Blog server is running!");
});

// MongoDB connect
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log(err));

// 🔌 socket setup
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

// 🧠 store online users
let onlineUsers = {};

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join", (email) => {
    if (email) {
      onlineUsers[email.toLowerCase()] = socket.id;
      console.log("Online Users:", onlineUsers);
    }
  });

  socket.on("sendMessage", (data) => {
    const { receiverEmail } = data;
    const receiverSocket = onlineUsers[receiverEmail?.toLowerCase()];

    if (receiverSocket) {
      io.to(receiverSocket).emit("receiveMessage", data);
    }

    socket.emit("receiveMessage", data);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    for (let email in onlineUsers) {
      if (onlineUsers[email] === socket.id) {
        delete onlineUsers[email];
      }
    }
  });
});

// firebase admin
const admin = require("firebase-admin");
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_KEY);

admin.initializeApp({
  credential: admin.credential.cert({
    ...serviceAccount,
    private_key: serviceAccount.private_key.replace(/\\n/g, "\n"),
  }),
});

// verify token
const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ error: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const user = await User.findOne({ email: decoded.email.toLowerCase() });

    req.user = {
      email: decoded.email.toLowerCase(),
      role: user?.role || "user",
    };
    next();
  } catch (err) {
    return res.status(403).send({ error: "Invalid token" });
  }
};

// verify admin
const verifyAdmin = async (req, res, next) => {
  const email = req.user.email;
  const user = await User.findOne({ email });

  if (user?.role !== "admin") {
    return res.status(403).send({ error: "Forbidden" });
  }
  next();
};

// User Schema
const userSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, uppercase: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    photoURL: { type: String, default: "" },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    status: { type: String, enum: ["active", "blocked"], default: "active" },
  },
  { timestamps: true, versionKey: false },
);

const User = mongoose.model("User", userSchema);

// User Routes
app.get("/public/users", async (req, res) => {
  try {
    const users = await User.find();
    res.send(users);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch users" });
  }
});

app.get("/users", async (req, res) => {
  try {
    const search = req.query.search || "";
    const page = parseInt(req.query.page) || 1;
    const limit = req.query.limit ? parseInt(req.query.limit) : null;

    const query = {
      $or: [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ],
    };

    const total = await User.countDocuments(query);
    let mongoQuery = User.find(query).sort({ createdAt: -1 });

    if (limit) {
      mongoQuery = mongoQuery.skip((page - 1) * limit).limit(limit);
    }

    const users = await mongoQuery;
    res.send({ users, total });
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch users" });
  }
});

app.get("/users/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await User.findById(id);
    if (!result) {
      return res
        .status(404)
        .send({ success: false, message: "user not found" });
    }
    res.send(result);
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});

app.get("/users/:email/role", verifyFirebaseToken, async (req, res) => {
  const email = req.params.email;
  if (req.user.email !== email.toLowerCase()) {
    return res.status(403).send({ error: "Forbidden" });
  }
  const user = await User.findOne({ email: email.toLowerCase() });
  res.send(user);
});

app.post("/users/register", async (req, res) => {
  try {
    const { name, email, photoURL } = req.body;
    if (!email) {
      return res.status(400).send({ message: "Email required" });
    }
    const user = await User.findOneAndUpdate(
      { email: email.toLowerCase() },
      { $set: { name, photoURL } },
      { upsert: true, new: true },
    );
    res.send({ success: true, user });
  } catch (err) {
    res.status(500).send({ success: false, message: "DB error" });
  }
});

app.patch("/users/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const updateData = req.body;
    const result = await User.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });
    if (!result) {
      return res.status(404).send({ error: "User not found" });
    }
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: "Update failed" });
  }
});

app.delete("/users/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await User.findByIdAndDelete(id);
    if (!result) {
      return res
        .status(404)
        .send({ success: false, message: "User not found" });
    }
    res.send({ success: true, message: "User deleted successfully" });
  } catch (err) {
    res.status(500).send({ success: false, message: err.message });
  }
});

app.get("/dashboard-stats", verifyFirebaseToken, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalAdmins = await User.countDocuments({ role: "admin" });
    const totalBlogs = await Blog.countDocuments();
    const totalComments = await Comment.countDocuments();
    res.send({ totalUsers, totalAdmins, totalBlogs, totalComments });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Blog Schema & Routes
const blogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    content: { type: String, required: true },
    image: { type: String },
    authorName: { type: String, required: true, uppercase: true },
    authorEmail: { type: String, required: true, lowercase: true, trim: true },
    likes: [String],
  },
  { timestamps: true, versionKey: false },
);
const Blog = mongoose.model("Blog", blogSchema);

app.get("/blogs", async (req, res) => {
  try {
    const { search = "", page = 1, limit } = req.query;
    const query = { title: { $regex: search, $options: "i" } };
    const blogs = await Blog.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 });
    const total = await Blog.countDocuments(query);
    res.send({ blogs, total });
  } catch (err) {
    res.status(500).send({ error: "Failed to fetch blogs" });
  }
});

app.get("/blogs/:id", async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) return res.status(404).send({ error: "Blog not found" });
    res.send(blog);
  } catch (err) {
    res.status(500).send({ error: "Failed to fetch blog" });
  }
});

app.post("/blogs", verifyFirebaseToken, async (req, res) => {
  try {
    const { title, content, image, authorName } = req.body;
    if (!title || !content) {
      return res.status(400).send({ error: "Title and content are required" });
    }
    const newBlog = new Blog({
      title,
      content,
      image,
      authorName,
      authorEmail: req.user.email,
      likes: [],
    });
    const savedBlog = await newBlog.save();
    res
      .status(201)
      .send({ message: "Blog created successfully", blog: savedBlog });
  } catch (err) {
    res
      .status(500)
      .send({ error: "Failed to create blog", details: err.message });
  }
});

app.patch("/blogs/:id/like", verifyFirebaseToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const { id } = req.params;
    const blog = await Blog.findById(id);
    if (!blog) return res.status(404).send({ error: "Blog not found" });

    const alreadyLiked = blog.likes.includes(userEmail);
    const updatedLikes = alreadyLiked
      ? blog.likes.filter((u) => u !== userEmail)
      : [...blog.likes, userEmail];

    const updatedBlog = await Blog.findByIdAndUpdate(
      id,
      { likes: updatedLikes },
      { new: true },
    );
    res.send({ success: true, likes: updatedBlog.likes });
  } catch (err) {
    res.status(500).send({ error: "Like failed" });
  }
});

app.patch("/blogs/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;
    const blog = await Blog.findById(id);
    if (!blog) return res.status(404).send({ error: "Blog not found" });
    if (blog.authorEmail !== req.user.email)
      return res.status(403).send({ error: "Unauthorized" });

    const updatedData = req.body;
    delete updatedData.authorEmail;
    delete updatedData.likes;

    const updated = await Blog.findByIdAndUpdate(id, updatedData, {
      new: true,
      runValidators: true,
    });
    res.send(updated);
  } catch (err) {
    res.status(500).send({ error: "Update failed" });
  }
});

app.delete("/blogs/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;
    const blog = await Blog.findById(id);
    if (!blog) return res.status(404).send({ error: "Blog not found" });

    if (
      req.user.role !== "admin" &&
      blog.authorEmail.toLowerCase() !== req.user.email.toLowerCase()
    ) {
      return res.status(403).send({ error: "Unauthorized" });
    }

    await Blog.findByIdAndDelete(id);
    res.send({ success: true, message: "Blog deleted successfully" });
  } catch (error) {
    res.status(500).send({ error: "Delete failed" });
  }
});

// Comment Schema & Routes
const commentSchema = new mongoose.Schema(
  {
    blogId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "Blog",
    },
    userEmail: { type: String, required: true, lowercase: true, trim: true },
    userName: { type: String, required: true },
    userImage: { type: String, required: true },
    text: { type: String, required: true, trim: true },
  },
  { timestamps: true, versionKey: false },
);

const Comment = mongoose.model("Comment", commentSchema);

app.post("/comments", async (req, res) => {
  try {
    const { blogId, userEmail, userName, userImage, text } = req.body;
    if (!blogId || !text)
      return res.status(400).send({ error: "Missing fields" });

    const comment = new Comment({
      blogId,
      userEmail,
      userName,
      userImage,
      text,
    });
    await comment.save();
    res.status(201).send(comment);
  } catch (err) {
    res.status(500).send({ error: "Failed to add comment" });
  }
});

app.patch("/comments/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;
    const comment = await Comment.findById(id);
    if (!comment) return res.status(404).send({ error: "Comment not found" });
    if (comment.userEmail !== req.user.email)
      return res.status(403).send({ error: "Unauthorized" });

    const updated = await Comment.findByIdAndUpdate(
      id,
      { text },
      { new: true },
    );
    res.send(updated);
  } catch (err) {
    res.status(500).send({ error: "Update failed" });
  }
});

app.get("/comments", async (req, res) => {
  try {
    const { search = "", page = 1, limit } = req.query;
    const query = search
      ? {
          $or: [
            { text: { $regex: search, $options: "i" } },
            { userName: { $regex: search, $options: "i" } },
            { userEmail: { $regex: search, $options: "i" } },
          ],
        }
      : {};

    const comments = await Comment.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 });

    const total = await Comment.countDocuments(query);
    res.send({ comments, total });
  } catch (err) {
    res.status(500).send({ error: "Failed to fetch comments" });
  }
});

app.get("/comments/id/:id", async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    res.send(comment);
  } catch (err) {
    res.status(500).send({ error: "Failed to fetch comment" });
  }
});

app.get("/comments/:blogId", async (req, res) => {
  try {
    const comments = await Comment.find({ blogId: req.params.blogId }).sort({
      createdAt: -1,
    });
    res.send(comments);
  } catch (err) {
    res.status(500).send({ error: "Failed to fetch comments" });
  }
});

app.delete("/comments/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).send({ error: "Comment not found" });

    if (
      req.user.role !== "admin" &&
      comment.userEmail.toLowerCase() !== req.user.email.toLowerCase()
    ) {
      return res.status(403).send({ error: "Unauthorized" });
    }

    await Comment.findByIdAndDelete(req.params.id);
    res.send({ success: true, message: "Comment deleted successfully" });
  } catch (error) {
    res.status(500).send({ error: "Delete failed" });
  }
});

// ===================================================
// Message Schema & Routes
const messageSchema = new mongoose.Schema(
  {
    senderEmail: { type: String, required: true, lowercase: true, trim: true },
    senderImage: String,
    senderName: String,
    receiverEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    receiverName: String,
    receiverImage: String,
    text: { type: String, required: true },
  },
  { timestamps: true },
);

const Message = mongoose.model("Message", messageSchema);

// POST Message
app.post("/messages", async (req, res) => {
  try {
    const message = req.body;
    const newMessage = new Message(message);
    await newMessage.save();
    res.send(newMessage);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// GET Messages User List
app.get("/messages/user", async (req, res) => {
  try {
    const { search = "", page = 1, limit } = req.query;
    const query = search
      ? {
          $or: [
            { text: { $regex: search, $options: "i" } },
            { senderEmail: { $regex: search, $options: "i" } },
            { senderName: { $regex: search, $options: "i" } },
            { receiverEmail: { $regex: search, $options: "i" } },
            { receiverName: { $regex: search, $options: "i" } },
          ],
        }
      : {};

    const messages = await Message.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 });

    const total = await Message.countDocuments(query);
    res.send({ messages, total });
  } catch (err) {
    res.status(500).send({ error: "Failed to fetch Messages" });
  }
});

// 💡 1. CHAT ROUTE MUST BE BEFORE /messages/:id
app.get("/messages/chat", async (req, res) => {
  try {
    const { email, chatWith } = req.query;
    if (!email || !chatWith) {
      return res.send([]);
    }
    const cleanEmail = email.toLowerCase().trim();
    const cleanChatWith = chatWith.toLowerCase().trim();

    const result = await Message.find({
      $or: [
        { senderEmail: cleanEmail, receiverEmail: cleanChatWith },
        { senderEmail: cleanChatWith, receiverEmail: cleanEmail },
      ],
    }).sort({ createdAt: 1 });

    res.send(result);
  } catch (err) {
    res.status(500).send({ error: "Failed to fetch chat history" });
  }
});

// 💡 2. GET SINGLE MESSAGE (MUST BE AFTER /messages/chat)
app.get("/messages/:id", async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).send({ error: "Message not found" });
    res.send(message);
  } catch (err) {
    res.status(500).send({ error: "Failed to fetch message" });
  }
});

// DELETE Message
app.delete("/messages/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await Message.findByIdAndDelete(id);
    if (!result) {
      return res
        .status(404)
        .send({ success: false, message: "Message not found" });
    }
    res.send({
      success: true,
      message: "Message deleted successfully",
      data: result,
    });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});

server.listen(port, () => {
  console.log(`Blog server on port ${port}`);
});
