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
router.post("/", async (req, res) => {
  const comment = new Comment(req.body);
  await comment.save();
  res.send(comment);
});

// GET COMMENTS BY BLOG
router.get("/:blogId", async (req, res) => {
  const comments = await Comment.find({ blogId: req.params.blogId });
  res.send(comments);
});

