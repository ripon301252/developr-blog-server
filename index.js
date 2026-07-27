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
    timestamps: true,   // createdAt, updatedAt
    versionKey: false,  // ❌ removes __v
  }
);

// model
const User = mongoose.model("User", userSchema);

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

    tags: [String],

    likes: [String], // user emails
    bookmarks: [String],

    readingTime: Number,

    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { versionKey: false }
);

const Blog = mongoose.model("Blog", blogSchema);


// comment Schema
const commentSchema = new mongoose.Schema(
  {
    blogId: String,
    userEmail: String,
    userName: String,
    text: String,
  },
  { timestamps: true, versionKey: false }
);

const Comment = mongoose.model("Comment", commentSchema);



// ADD COMMENT
app.post("/comments", async (req, res) => {
  const comment = new Comment(req.body);
  await comment.save();
  res.send(comment);
});

// GET COMMENTS BY BLOG
app.get("/comments/:blogId", async (req, res) => {
  const comments = await Comment.find({ blogId: req.params.blogId });
  res.send(comments);
});






app.listen(port, () => {
  console.log(`Blog server on port ${port}`);
});
