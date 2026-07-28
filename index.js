require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
const port = process.env.PORT || 3000;

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

// user Schema
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
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
  },
  {
    timestamps: true, // createdAt, updatedAt
    versionKey: false, // ❌ removes __v
  },
);

// model
const User = mongoose.model("User", userSchema);

// All get
app.get("/users", async (req, res) => {
  try {
    const users = await User.find();
    res.send(users);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch users" });
  }
});

// post
app.post("/users", async (req, res) => {
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

// blog Schema
const blogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    content: { type: String, required: true },
    image: { type: String },

    authorName: String,
    authorEmail: String,

    likes: [String], // user emails

    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { versionKey: false },
);

const Blog = mongoose.model("Blog", blogSchema);

// All get
app.get("/blogs", async (req, res) => {
  try {
    const blogs = await Blog.find();
    res.send(blogs);
  } catch (error) {
    res.status(500).send({ error: "Failed to fetch users" });
  }
});

// post-blog
app.post("/blogs", async (req, res) => {
  try {
    const { title, content, image, authorName, authorEmail } = req.body;

    // basic validation
    if (!title || !content) {
      return res.status(400).send({
        error: "Title and content are required",
      });
    }

    const newBlog = new Blog({
      title,
      content,
      image,
      authorName,
      authorEmail,
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

app.patch("/blogs/:id/like", async (req, res) => {
  try {
    const { userId } = req.body;
    const { id } = req.params;

    const blog = await Blog.findById(id);

    if (!blog) {
      return res.status(404).send({ error: "Blog not found" });
    }

    const alreadyLiked = blog.likes.includes(userId);

    let updatedLikes;

    if (alreadyLiked) {
      updatedLikes = blog.likes.filter((u) => u !== userId);
    } else {
      updatedLikes = [...blog.likes, userId];
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

app.listen(port, () => {
  console.log(`Blog server on port ${port}`);
});
