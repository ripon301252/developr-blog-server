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