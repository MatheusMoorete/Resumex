"""Script to generate test fixture PDF: aspects-historicos-sus-annotated.pdf"""

from pathlib import Path
import pymupdf as fitz


def create_sus_annotated_pdf(output_path: Path) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc = fitz.open()

    # Página 1: Texto + Tabela + Manuscrito à caneta (Ink)
    p1 = doc.new_page(width=600, height=800)
    p1.insert_text((50, 40), "Aspectos históricos do SUS", fontsize=20)
    p1.insert_text((50, 70), "Tipologias dos sistemas de Saúde", fontsize=14)
    # Tabela nativa com linhas
    p1.draw_rect(fitz.Rect(50, 100, 550, 300))
    p1.draw_line(fitz.Point(50, 140), fitz.Point(550, 140))
    p1.draw_line(fitz.Point(175, 100), fitz.Point(175, 300))
    p1.draw_line(fitz.Point(300, 100), fitz.Point(300, 300))
    p1.draw_line(fitz.Point(425, 100), fitz.Point(425, 300))
    p1.insert_text((60, 120), "Smithiano")
    p1.insert_text((185, 120), "Bismarckiano")
    p1.insert_text((310, 120), "Beveridgiano")
    p1.insert_text((435, 120), "Semashko")
    # Anotações à caneta azul/vermelha (Ink annot)
    ink1 = p1.add_ink_annot([[(50, 15), (200, 15)], [(50, 20), (180, 20)]])
    ink1.set_info({"content": "SUS -> resultado de um contexto"})
    ink1.set_colors(stroke=(0.0, 0.2, 0.8))  # Azul
    ink1.update()

    # Página 2: Linha do tempo + caneta vermelha
    p2 = doc.new_page(width=600, height=800)
    p2.insert_text((50, 40), "História da Saúde no Brasil", fontsize=18)
    p2.insert_text((50, 100), "1883 Modelo Bismarckiano")
    p2.insert_text((50, 150), "1923 CAPs")
    ink2 = p2.add_ink_annot([[(300, 100), (450, 100)]])
    ink2.set_info({"content": "combate as epidemias / coordenação de danos"})
    ink2.set_colors(stroke=(0.8, 0.0, 0.0))  # Vermelho
    ink2.update()

    # Página 3: Texto + Destaques (Highlight) + Manuscrito
    p3 = doc.new_page(width=600, height=800)
    p3.insert_text((50, 50), "Contexto: Política do Café-com-leite. Foco em controle de epidemias.", fontsize=12)
    hl = p3.add_highlight_annot(fitz.Rect(50, 45, 400, 65))
    hl.set_info({"content": "Foco em controle de epidemias"})
    hl.update()
    p3.insert_text((50, 100), "Lei Eloy Chaves - 1923 - Criação da Previdência Social", fontsize=12)
    ink3 = p3.add_ink_annot([[(50, 120), (350, 120)]])
    ink3.set_info({"content": "financiamento -> 3% do salário"})
    ink3.set_colors(stroke=(0.8, 0.0, 0.0))
    ink3.update()

    # Página 4: Reforma Sanitária (Quase puramente visual / escaneada com pouca seleção)
    p4 = doc.new_page(width=600, height=800)
    pix4 = fitz.Pixmap(fitz.csRGB, fitz.Rect(0, 0, 500, 700), False)
    pix4.clear_with(240)
    p4.insert_image(fitz.Rect(50, 50, 550, 750), pixmap=pix4)

    # Página 5: Base legal do SUS
    p5 = doc.new_page(width=600, height=800)
    p5.insert_text((50, 50), "Base legal do SUS - Seguridade Social", fontsize=16)

    # Página 6: Tabela Princípios e Diretrizes (Universalidade, Integralidade, Equidade)
    p6 = doc.new_page(width=600, height=800)
    p6.insert_text((50, 40), "Princípios e diretrizes 1. Éticos/doutrinários", fontsize=16)
    p6.draw_rect(fitz.Rect(50, 80, 550, 300))
    p6.draw_line(fitz.Point(50, 120), fitz.Point(550, 120))
    p6.draw_line(fitz.Point(200, 80), fitz.Point(200, 300))
    p6.insert_text((60, 100), "Princípio")
    p6.insert_text((210, 100), "Definição")
    p6.insert_text((60, 150), "Universalidade")
    p6.insert_text((210, 150), "Não se pode impor qualquer tipo de obstáculo ao acesso")
    p6.insert_text((60, 200), "Integralidade")
    p6.insert_text((210, 200), "Conjunto de ações e serviços em todos os níveis")
    p6.insert_text((60, 250), "Equidade")
    p6.insert_text((210, 250), "Atuar com senso de justiça")

    # Página 7: Tabela Princípios Organizativos (Descentralização, Regionalização, Participação)
    p7 = doc.new_page(width=600, height=800)
    p7.insert_text((50, 40), "2. Princípios organizativos (diretrizes)", fontsize=16)
    p7.draw_rect(fitz.Rect(50, 80, 550, 300))
    p7.draw_line(fitz.Point(50, 120), fitz.Point(550, 120))
    p7.draw_line(fitz.Point(200, 80), fitz.Point(200, 300))
    p7.insert_text((60, 100), "Princípio")
    p7.insert_text((210, 100), "Definição")
    p7.insert_text((60, 150), "Descentralização")
    p7.insert_text((210, 150), "Desconcentração do poder da União para municípios")
    p7.insert_text((60, 200), "Regionalização")
    p7.insert_text((210, 200), "Atuação colaborativa por território")
    p7.insert_text((60, 250), "Participação Popular")
    p7.insert_text((210, 250), "Participação da população na gestão do SUS")

    # Página 8: Conselhos de Saúde
    p8 = doc.new_page(width=600, height=800)
    p8.insert_text((50, 50), "Conselhos de saúde - Composição paritária", fontsize=16)

    # Página 9: Vigilâncias em saúde
    p9 = doc.new_page(width=600, height=800)
    p9.insert_text((50, 50), "Conferências de Saúde e Vigilâncias em Saúde", fontsize=16)

    # Página 10: Tabela Vigilâncias
    p10 = doc.new_page(width=600, height=800)
    p10.insert_text((50, 40), "Vigilâncias e atuação", fontsize=16)
    p10.draw_rect(fitz.Rect(50, 80, 550, 300))
    p10.draw_line(fitz.Point(50, 120), fitz.Point(550, 120))
    p10.draw_line(fitz.Point(200, 80), fitz.Point(200, 300))
    p10.insert_text((60, 100), "Vigilância")
    p10.insert_text((210, 100), "Onde atua?")
    p10.insert_text((60, 150), "Sanitária")
    p10.insert_text((210, 150), "Bens, serviços e meio ambiente")
    p10.insert_text((60, 200), "Epidemiológica")
    p10.insert_text((210, 200), "Doenças transmissíveis e não transmissíveis")

    doc.save(str(output_path))
    doc.close()
    return output_path
