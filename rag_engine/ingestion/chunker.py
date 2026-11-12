import re
from typing import List, Optional, Dict, Any
from langchain_text_splitters import RecursiveCharacterTextSplitter, MarkdownHeaderTextSplitter
from langchain_core.documents import Document

class Chunk:
    def __init__(
        self,
        chunk_index: int,
        content: str,
        chunk_type: str = "text",  # "text" | "table" | "image_desc"
        page_number: Optional[int] = None,
        section_heading: Optional[str] = None,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        self.chunk_index = chunk_index
        self.content = content
        self.chunk_type = chunk_type
        self.page_number = page_number
        self.section_heading = section_heading
        self.start_time = start_time
        self.end_time = end_time
        self.metadata = metadata or {}

    def to_langchain_document(self) -> Document:
        """Convert to standard LangChain Document object."""
        meta = {
            "chunk_index": self.chunk_index,
            "chunk_type": self.chunk_type,
            "page_number": self.page_number,
            "section_heading": self.section_heading,
            "start_time": self.start_time,
            "end_time": self.end_time,
            **self.metadata
        }
        return Document(page_content=self.content, metadata=meta)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "chunk_index": self.chunk_index,
            "content": self.content,
            "chunk_type": self.chunk_type,
            "page_number": self.page_number,
            "section_heading": self.section_heading,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "metadata": self.metadata
        }

def is_heading(line: str) -> bool:
    """Detect whether a line is a section heading."""
    clean = line.strip()
    if not clean or len(clean) > 120:
        return False
    if clean.startswith("#"):
        return True
    if clean.isupper() and len(clean) > 3 and any(c.isalpha() for c in clean):
        return True
    if re.match(r"^(\d+\.){1,3}\s+[A-Z]", clean):
        return True
    return False

# LangChain Recursive Character Text Splitter with standard paragraph/sentence separators
_langchain_text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=950,
    chunk_overlap=150,
    length_function=len,
    separators=["\n\n", "\n", ". ", " ", ""]
)

# LangChain Markdown Header Text Splitter for structured notes
_markdown_header_splitter = MarkdownHeaderTextSplitter(
    headers_to_split_on=[
        ("#", "Header 1"),
        ("##", "Header 2"),
        ("###", "Header 3"),
    ]
)

def recursive_chunk_text(
    text: str,
    page_number: Optional[int] = None,
    start_index: int = 0
) -> List[Chunk]:
    """
    Split text using LangChain's RecursiveCharacterTextSplitter,
    preserving page numbers, document structure, and section headings.
    """
    chunks: List[Chunk] = []
    if not text or not text.strip():
        return chunks

    # Use LangChain splitter to produce chunks
    split_docs = _langchain_text_splitter.create_documents([text])
    current_index = start_index

    for doc in split_docs:
        content = doc.page_content.strip()
        if len(content) < 20:
            continue

        # Detect heading from first line of chunk
        lines = content.split("\n")
        section_heading = None
        first_line = lines[0].strip()
        if first_line.startswith("#") or (first_line.isupper() and len(first_line) < 80):
            section_heading = first_line.lstrip("#").strip()

        chunks.append(
            Chunk(
                chunk_index=current_index,
                content=content,
                chunk_type="text",
                page_number=page_number,
                section_heading=section_heading
            )
        )
        current_index += 1

    return chunks

def chunk_markdown_with_langchain(markdown_text: str, start_index: int = 0) -> List[Chunk]:
    """
    Split structured Markdown notes using LangChain MarkdownHeaderTextSplitter,
    then subdivide oversized sections with RecursiveCharacterTextSplitter.
    """
    header_docs = _markdown_header_splitter.split_text(markdown_text)
    split_docs = _langchain_text_splitter.split_documents(header_docs)
    
    chunks: List[Chunk] = []
    for i, doc in enumerate(split_docs):
        # Extract deepest header as section_heading
        heading = (
            doc.metadata.get("Header 3") or
            doc.metadata.get("Header 2") or
            doc.metadata.get("Header 1")
        )
        chunks.append(
            Chunk(
                chunk_index=start_index + i,
                content=doc.page_content.strip(),
                chunk_type="text",
                page_number=None,
                section_heading=heading,
                metadata=doc.metadata
            )
        )
    return chunks
