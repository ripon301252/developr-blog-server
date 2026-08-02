require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const http = require("http");
const { Server } = require("socket.io"); // ✅ correct import

const app = express();
const port = process.env.PORT || 5000;
const server = http.createServer(app); // ✅ create server

// middle ware
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

  // join
  socket.on("join", (email) => {
    onlineUsers[email] = socket.id;
    console.log("Online Users:", onlineUsers);
  });

  // send message
  socket.on("sendMessage", (data) => {
    const { receiverEmail } = data;

    const receiverSocket = onlineUsers[receiverEmail];

    if (receiverSocket) {
      io.to(receiverSocket).emit("receiveMessage", data);
    }

    // sender side update
    socket.emit("receiveMessage", data);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    // 🧹 remove user from online list
    for (let email in onlineUsers) {
      if (onlineUsers[email] === socket.id) {
        delete onlineUsers[email];
      }
    }
  });
});

// firebase admin
const admin = require("firebase-admin");
// serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_KEY);

// console.log("ADMIN:", admin);
// console.log("SERVICE:", serviceAccount);

// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
// });


const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_KEY);
console.log("ADMIN:", admin);
console.log("SERVICE:", serviceAccount);

admin.initializeApp({
  credential: admin.credential.cert({
    ...serviceAccount,
    private_key: serviceAccount.private_key.replace(/\\n/g, "\n"),
  }),
});

// token verify
const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).send({ error: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded; // email থাকবে এখানে
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

// user Schema
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      uppercase: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    photoURL: {
      type: String,
      default: "",
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    status: {
      type: String,
      enum: ["active", "blocked"],
      default: "active",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// model
const User = mongoose.model("User", userSchema);

// All get
app.get("/public/users", async (req, res) => {
  try {
    const users = await User.find();
    res.send(users);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch users" });
  }
});

// All get & search
app.get("/users", async (req, res) => {
  try {
    const search = req.query.search || "";
    const page = parseInt(req.query.page) || 1;

    // 🔥 limit optional
    const limit = req.query.limit ? parseInt(req.query.limit) : null;

    const query = {
      $or: [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ],
    };

    const total = await User.countDocuments(query);

    let mongoQuery = User.find(query).sort({ createdAt: -1 });

    // 👉 only apply pagination if limit exists
    if (limit) {
      mongoQuery = mongoQuery.skip((page - 1) * limit).limit(limit);
    }

    const users = await mongoQuery;

    res.send({ users, total });
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch users" });
  }
});

// single get
app.get("/users/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await User.findById(id);

    if (!result) {
      return res.status(404).send({
        success: false,
        message: "user not found",
      });
    }

    res.send(result);
  } catch (error) {
    res.status(500).send({
      success: false,
      message: error.message,
    });
  }
});

// role
app.get("/users/:email/role", verifyFirebaseToken, async (req, res) => {
  const email = req.params.email;

  // 🔥 user can only access his own data
  if (req.user.email !== email) {
    return res.status(403).send({ error: "Forbidden" });
  }

  const user = await User.findOne({ email });

  res.send(user);
});

// post
app.post("/users/register", async (req, res) => {
  try {
    const { name, email, photoURL } = req.body;

    if (!email) {
      return res.status(400).send({ message: "Email required" });
    }

    const user = await User.findOneAndUpdate(
      { email }, // 🔥 email দিয়ে match
      {
        $set: { name, photoURL },
      },
      {
        upsert: true, // না থাকলে create
        new: true, // updated doc return
      },
    );

    res.send({
      success: true,
      user,
    });
  } catch (err) {
    res.status(500).send({
      success: false,
      message: "DB error",
    });
  }
});

// patch
app.patch("/users/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const updateData = req.body;

    const result = await User.findByIdAndUpdate(id, updateData, {
      new: true, // ✅ updated data return করবে
      runValidators: true, // ✅ schema validation apply হবে
    });

    if (!result) {
      return res.status(404).send({ error: "User not found" });
    }

    res.send(result);
  } catch (err) {
    console.log(err.message);
    res.status(500).send({ error: "Update failed" });
  }
});

// Delete
app.delete("/users/:id", async (req, res) => {
  try {
    const id = req.params.id; // ✅ ঠিক

    const result = await User.findByIdAndDelete(id); // ✅ correct method

    if (!result) {
      return res.status(404).send({
        success: false,
        message: "User not found",
      });
    }

    res.send({
      success: true,
      message: "User deleted successfully",
    });
  } catch (err) {
    res.status(500).send({
      success: false,
      message: err.message,
    });
  }
});

// dashboard-status
app.get("/dashboard-stats", verifyFirebaseToken, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalAdmins = await User.countDocuments({ role: "admin" });
    const totalBlogs = await Blog.countDocuments();
    const totalComments = await Comment.countDocuments();

    res.send({
      totalUsers,
      totalAdmins,
      totalBlogs,
      totalComments,
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// ===================================================

// blog Schema
const blogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    content: { type: String, required: true },
    image: { type: String },

    authorName: {
      type: String,
      required: true,
      uppercase: true,
    },
    authorEmail: {
      type: String,
      required: true,
    },
    likes: [String], // user emails

    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { versionKey: false },
);
// model
const Blog = mongoose.model("Blog", blogSchema);

// All get
app.get("/blogs", verifyFirebaseToken, async (req, res) => {
  try {
    const blogs = await Blog.find();
    res.send(blogs);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch users" });
  }
});

// Public blogs (no token needed)
app.get("/public/blogs", async (req, res) => {
  try {
    const blogs = await Blog.find().select("authorName authorPhoto image title");
    res.send(blogs);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch blogs" });
  }
});


// post-blog
app.post("/blogs", verifyFirebaseToken, async (req, res) => {
  try {
    const { title, content, image, authorName, authorEmail } = req.body;

    // basic validation
    if (!title || !content) {
      return res.status(400).send({
        error: "Title and content are required",
      });
    }

    const userEmail = req.user.email;

    const newBlog = new Blog({
      title,
      content,
      image,
      authorName,
      authorEmail: userEmail, // ✅ secure
      likes: [],
    });

    const savedBlog = await newBlog.save();

    res.status(201).send({
      message: "Blog created successfully",
      blog: savedBlog,
    });
  } catch (err) {
    res.status(500).send({
      error: "Failed to create blog",
      details: err.message,
    });
  }
});

// Like
app.patch("/blogs/:id/like", verifyFirebaseToken, async (req, res) => {
  try {
    const userEmail = req.user.email; // ✅ trusted
    const { id } = req.params;

    const blog = await Blog.findById(id);

    if (!blog) {
      return res.status(404).send({ error: "Blog not found" });
    }

    const alreadyLiked = blog.likes.includes(userEmail);

    let updatedLikes;

    if (alreadyLiked) {
      // unlike
      updatedLikes = blog.likes.filter((u) => u !== userEmail);
    } else {
      // like
      updatedLikes = [...blog.likes, userEmail];
    }

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

// update blog
app.patch("/blogs/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params; // ✅ step 1

    const blog = await Blog.findById(id); // ✅ step 2

    if (!blog) {
      return res.status(404).send({ error: "Blog not found" });
    }

    // 🔐 step 3: owner check
    if (blog.authorEmail !== req.user.email) {
      return res.status(403).send({ error: "Unauthorized" });
    }

    const updatedData = req.body;

    // 🔐 prevent sensitive field overwrite
    delete updatedData.authorEmail;
    delete updatedData.likes;

    // ✅ step 4: update
    const updated = await Blog.findByIdAndUpdate(id, updatedData, {
      new: true,
      runValidators: true, // ✅ validation on update
    });

    res.send(updated);
  } catch (err) {
    res.status(500).send({ error: "Update failed" });
  }
});

// Delete blog
app.delete("/blogs/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params; // ✅ step 1

    const blog = await Blog.findById(id); // ✅ step 2

    if (!blog) {
      return res.status(404).send({ error: "Blog not found" });
    }

    // 🔐 step 3: owner check
    if (blog.authorEmail !== req.user.email) {
      return res.status(403).send({ error: "Unauthorized" });
    }

    // ✅ step 4: delete
    await Blog.findByIdAndDelete(id);

    res.send({ success: true, message: "Blog deleted" });
  } catch (error) {
    res.status(500).send({ error: "Delete failed" });
  }
});

// comment Schema
const commentSchema = new mongoose.Schema(
  {
    blogId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "Blog",
    },
    userEmail: {
      type: String,
      required: true,
    },
    userName: {
      type: String,
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true, versionKey: false },
);

const Comment = mongoose.model("Comment", commentSchema);

app.post("/comments", async (req, res) => {
  try {
    const { blogId, userEmail, userName, text } = req.body;

    // 🔐 validation
    if (!blogId || !text) {
      return res.status(400).send({ error: "Missing fields" });
    }

    const comment = new Comment({
      blogId,
      userEmail,
      userName,
      text,
    });

    await comment.save();

    res.status(201).send(comment);
  } catch (err) {
    res.status(500).send({ error: "Failed to add comment" });
  }
});

// update Comments
// ✅ CORRECT
app.patch("/comments/:id", verifyFirebaseToken, async (req, res) => {
  const userEmail = req.user.email;
  try {
    const { id } = req.params;
    const { text, userEmail } = req.body;

    const comment = await Comment.findById(id);

    if (!comment) {
      return res.status(404).send({ error: "Comment not found" });
    }

    // 🔐 OWNER CHECK
    if (comment.userEmail !== userEmail) {
      return res.status(403).send({ error: "Unauthorized" });
    }

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

// GET COMMENTS BY BLOG
app.get("/comments/:blogId", async (req, res) => {
  try {
    const { blogId } = req.params;

    const comments = await Comment.find({ blogId }).sort({ createdAt: -1 });

    res.send(comments);
  } catch (err) {
    res.status(500).send({ error: "Failed to fetch comments" });
  }
});

app.delete("/comments/:id", verifyFirebaseToken, async (req, res) => {
  const userEmail = req.user.email;
  try {
    const { id } = req.params;
    const { userEmail } = req.body;

    const comment = await Comment.findById(id);

    if (!comment) {
      return res.status(404).send({ error: "Comment not found" });
    }

    // 🔐 OWNER CHECK
    if (comment.userEmail !== userEmail) {
      return res.status(403).send({ error: "Unauthorized" });
    }

    await Comment.findByIdAndDelete(id);

    res.send({ success: true, message: "Comment deleted" });
  } catch (err) {
    res.status(500).send({ error: "Delete failed" });
  }
});

// =================================
// messageSchema
const messageSchema = new mongoose.Schema(
  {
    senderEmail: String,
    receiverEmail: String,
    text: String,
  },
  { timestamps: true },
);

const Message = mongoose.model("Message", messageSchema);

// send message
app.post("/messages", async (req, res) => {
  try {
    const message = req.body;

    console.log("INCOMING 👉", message); // DEBUG

    const newMessage = new Message(message);
    await newMessage.save();

    res.send(newMessage);
  } catch (err) {
    console.error("SERVER ERROR ❌", err);
    res.status(500).send({ error: err.message });
  }
});

// get messages between 2 users
app.get("/messages", async (req, res) => {
  const { email, chatWith } = req.query;

  const result = await Message.find({
    $or: [
      { senderEmail: email, receiverEmail: chatWith },
      { senderEmail: chatWith, receiverEmail: email },
    ],
  }).sort({ createdAt: 1 });

  res.send(result);
});

server.listen(port, () => {
  console.log(`Blog server on port ${port}`);
});
