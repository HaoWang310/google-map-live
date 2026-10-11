<?xml version="1.0" encoding="UTF-8"?><sld:StyledLayerDescriptor xmlns:sld="http://www.opengis.net/sld" xmlns:gml="http://www.opengis.net/gml" xmlns:ogc="http://www.opengis.net/ogc" xmlns="http://www.opengis.net/sld" version="1.0.0">
    <sld:NamedLayer>
        <sld:Name>rofrs_4band</sld:Name>
        <sld:UserStyle>
            <sld:Name>Risk_of_Flooding_from_Rivers_and_Sea_0mm</sld:Name>
            <sld:Title>Risk of Flooding from Rivers and Sea &gt; 0mm</sld:Title>
            <sld:IsDefault>1</sld:IsDefault>
            <sld:FeatureTypeStyle>
                <sld:Name>name</sld:Name>
                <sld:Rule>
                    <sld:Name>High</sld:Name>
                    <sld:Title>High</sld:Title>
                    <ogc:Filter>
                        <ogc:PropertyIsEqualTo>
                            <ogc:PropertyName>risk_band</ogc:PropertyName>
                            <ogc:Literal>High</ogc:Literal>
                        </ogc:PropertyIsEqualTo>
                    </ogc:Filter>
                    <sld:MaxScaleDenominator>50000.0</sld:MaxScaleDenominator>
                    <sld:PolygonSymbolizer>
                        <sld:Fill>
                            <sld:CssParameter name="fill">#555b9d</sld:CssParameter>
                        </sld:Fill>
                    </sld:PolygonSymbolizer>
                    <sld:PolygonSymbolizer>
                        <sld:Stroke>
                            <sld:CssParameter name="stroke">#6e6e6e</sld:CssParameter>
                            <sld:CssParameter name="stroke-width">0.0</sld:CssParameter>
                        </sld:Stroke>
                    </sld:PolygonSymbolizer>
                </sld:Rule>
                <sld:Rule>
                    <sld:Name>Medium</sld:Name>
                    <sld:Title>Medium</sld:Title>
                    <ogc:Filter>
                        <ogc:PropertyIsEqualTo>
                            <ogc:PropertyName>risk_band</ogc:PropertyName>
                            <ogc:Literal>Medium</ogc:Literal>
                        </ogc:PropertyIsEqualTo>
                    </ogc:Filter>
                    <sld:MaxScaleDenominator>50000.0</sld:MaxScaleDenominator>
                    <sld:PolygonSymbolizer>
                        <sld:Fill>
                            <sld:CssParameter name="fill">#9a9fde</sld:CssParameter>
                        </sld:Fill>
                    </sld:PolygonSymbolizer>
                    <sld:PolygonSymbolizer>
                        <sld:Stroke>
                            <sld:CssParameter name="stroke">#6e6e6e</sld:CssParameter>
                            <sld:CssParameter name="stroke-width">0.0</sld:CssParameter>
                        </sld:Stroke>
                    </sld:PolygonSymbolizer>
                </sld:Rule>
                <sld:Rule>
                    <sld:Name>Low</sld:Name>
                    <sld:Title>Low</sld:Title>
                    <ogc:Filter>
                        <ogc:PropertyIsEqualTo>
                            <ogc:PropertyName>risk_band</ogc:PropertyName>
                            <ogc:Literal>Low</ogc:Literal>
                        </ogc:PropertyIsEqualTo>
                    </ogc:Filter>
                    <sld:MaxScaleDenominator>50000.0</sld:MaxScaleDenominator>
                    <sld:PolygonSymbolizer>
                        <sld:Fill>
                            <sld:CssParameter name="fill">#c3e0ff</sld:CssParameter>
                        </sld:Fill>
                    </sld:PolygonSymbolizer>
                    <sld:PolygonSymbolizer>
                        <sld:Stroke>
                            <sld:CssParameter name="stroke">#6e6e6e</sld:CssParameter>
                            <sld:CssParameter name="stroke-width">0.0</sld:CssParameter>
                        </sld:Stroke>
                    </sld:PolygonSymbolizer>
                </sld:Rule>
                <sld:Rule>
                    <sld:Name>Very_low</sld:Name>
                    <sld:Title>Very low</sld:Title>
                    <ogc:Filter>
                        <ogc:Or>
                            <ogc:PropertyIsEqualTo>
                                <ogc:PropertyName>risk_band</ogc:PropertyName>
                                <ogc:Literal>Very Low</ogc:Literal>
                            </ogc:PropertyIsEqualTo>
                            <ogc:PropertyIsEqualTo>
                                <ogc:PropertyName>risk_band</ogc:PropertyName>
                                <ogc:Literal>Very low</ogc:Literal>
                            </ogc:PropertyIsEqualTo>
                        </ogc:Or>
                    </ogc:Filter>
                    <sld:MaxScaleDenominator>50000.0</sld:MaxScaleDenominator>
                    <sld:PolygonSymbolizer>
                        <sld:Fill>
                            <sld:CssParameter name="fill">#c8f7ff</sld:CssParameter>
                        </sld:Fill>
                    </sld:PolygonSymbolizer>
                    <sld:PolygonSymbolizer>
                        <sld:Stroke>
                            <sld:CssParameter name="stroke">#6e6e6e</sld:CssParameter>
                            <sld:CssParameter name="stroke-width">0.0</sld:CssParameter>
                        </sld:Stroke>
                    </sld:PolygonSymbolizer>
                </sld:Rule>
                <sld:Rule>
                    <sld:Name>Unavailable</sld:Name>
                    <sld:Title>Unavailable</sld:Title>
                    <ogc:Filter>
                        <ogc:PropertyIsEqualTo>
                            <ogc:PropertyName>risk_band</ogc:PropertyName>
                            <ogc:Literal>Unavailable</ogc:Literal>
                        </ogc:PropertyIsEqualTo>
                    </ogc:Filter>
                    <sld:MaxScaleDenominator>50000.0</sld:MaxScaleDenominator>
                    <sld:PolygonSymbolizer>
                        <sld:Fill>
                            <sld:CssParameter name="fill">#b0b3b4</sld:CssParameter>
                        </sld:Fill>
                    </sld:PolygonSymbolizer>
                    <sld:PolygonSymbolizer>
                        <sld:Stroke>
                            <sld:CssParameter name="stroke">#6e6e6e</sld:CssParameter>
                            <sld:CssParameter name="stroke-opacity">0.0</sld:CssParameter>
                            <sld:CssParameter name="stroke-width">0.0</sld:CssParameter>
                        </sld:Stroke>
                    </sld:PolygonSymbolizer>
                </sld:Rule>
            </sld:FeatureTypeStyle>
        </sld:UserStyle>
    </sld:NamedLayer>
</sld:StyledLayerDescriptor>

