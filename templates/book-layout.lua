-- PDF layout rules pandoc's LaTeX writer doesn't apply by itself. The file's
-- bytes join the edition digest, since they shape the PDF as the template does.

local LATEX_SPECIALS = {
  ["\\"] = "\\textbackslash{}", ["&"] = "\\&", ["%"] = "\\%", ["$"] = "\\$",
  ["#"] = "\\#", ["_"] = "\\_", ["{"] = "\\{", ["}"] = "\\}",
  ["~"] = "\\textasciitilde{}", ["^"] = "\\textasciicircum{}",
}

local function latex_text(text)
  return (text:gsub("[\\&%%$#_{}~^]", LATEX_SPECIALS))
end

-- An unnumbered chapter's sections are unnumbered too, and its pages carry its
-- own title as their running head. Without this, the sections of "About this
-- book {.unnumbered}" print as 0.1, 0.2, ..., a study plan after chapter 9
-- prints its sections as 9.12, 9.13, ..., and a glossary's pages keep the last
-- numbered section's head ("7.8. Answers").
local function unnumber_sections_of_unnumbered_chapters(blocks)
  local kept = pandoc.List()
  local inside = false
  for _, block in ipairs(blocks) do
    kept:insert(block)
    if block.t == "Header" then
      if block.level == 1 then
        inside = block.classes:includes("unnumbered")
        if inside then
          local title = latex_text(pandoc.utils.stringify(block.content))
          kept:insert(pandoc.RawBlock("latex", "\\markboth{" .. title .. "}{" .. title .. "}"))
        end
      elseif inside and not block.classes:includes("unnumbered") then
        block.classes:insert("unnumbered")
      end
    end
  end
  return kept
end

-- Keep a table with the paragraph that introduces it. Before a paragraph that
-- is directly followed by a table, ask LaTeX for room for the paragraph and
-- the table's first rows; if they don't fit, both move to the next page, so a
-- label such as "Income statement." never ends a page alone.
local function keep_tables_with_their_lead_in(blocks)
  local kept = pandoc.List()
  for i, block in ipairs(blocks) do
    local following = blocks[i + 1]
    if block.t == "Para" and following ~= nil and following.t == "Table" then
      kept:insert(pandoc.RawBlock("latex", "\\needspace{8\\baselineskip}"))
    end
    kept:insert(block)
  end
  return kept
end

-- A book whose theme names a scene break (metadata scenebreak, set from its design
-- tokens) sets each horizontal rule as the template's \scenebreak: the theme's mark
-- centered between scenes, and the next paragraph flush.
local function scene_breaks(blocks)
  return blocks:map(function(block)
    if block.t == "HorizontalRule" then return pandoc.RawBlock("latex", "\\scenebreak") end
    return block
  end)
end

local function first_character(text)
  local finish = utf8.offset(text, 2)
  if finish == nil then return text, "" end
  return text:sub(1, finish - 1), text:sub(finish)
end

local function apply_drop_caps(blocks)
  local awaiting = false
  for _, block in ipairs(blocks) do
    if block.t == "Header" and block.level == 1 then
      awaiting = true
    elseif awaiting and block.t == "Para" then
      for index, inline in ipairs(block.content) do
        if inline.t == "Str" and inline.text:match("%a") then
          local first, rest = first_character(inline.text)
          local cap = FORMAT:match("latex") and pandoc.RawInline("latex", "\\bookdropcap{" .. latex_text(first) .. "}")
            or pandoc.Span({ pandoc.Str(first) }, pandoc.Attr("", { "drop-cap" }))
          block.content[index] = pandoc.Str(rest)
          block.content:insert(index, cap)
          awaiting = false
          break
        end
      end
    end
  end
  return blocks
end

function Pandoc(doc)
  if doc.meta.scenebreak then doc.blocks = scene_breaks(doc.blocks) end
  if doc.meta.dropcaps then doc.blocks = apply_drop_caps(doc.blocks) end
  doc.blocks = unnumber_sections_of_unnumbered_chapters(doc.blocks)
  doc.blocks = keep_tables_with_their_lead_in(doc.blocks)
  -- Tables nested inside other blocks (lists, quotes) keep their lead-in too.
  doc = doc:walk({ Blocks = keep_tables_with_their_lead_in })
  return doc
end
